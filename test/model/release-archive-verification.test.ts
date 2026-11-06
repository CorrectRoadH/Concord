import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { HAWDB_ABI, HAWDB_REVISION } from '../../src/base/installation/index.ts';
import { mustRun } from '../../scripts/perf/process.ts';
import { decodeReleaseChecksums, validateElfInspection, verifyReleaseArchive } from '../../scripts/verify-release-archive.ts';

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
test('candidate checksums require unique basenames and never include the manifest itself', () => {
  const digest = 'a'.repeat(64);
  assert.equal(decodeReleaseChecksums(`${digest}  concord-1.2.3-linux-x64.tar.gz\n`).get('concord-1.2.3-linux-x64.tar.gz'), digest);
  for (const text of [`${digest}  release/file.tgz\n`, `${digest}  SHA256SUMS\n`, `${digest}  file.tgz\n${digest}  file.tgz\n`, 'not-a-digest  file.tgz\n']) assert.throws(() => decodeReleaseChecksums(text));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
test('ELF acceptance rejects missing dependencies, foreign interpreters, escaped RPATH and newer glibc', () => {
  const root = '/candidate', file = `${root}/runtime/node`, bundled = new Set(['libatomic.so.1', 'libstdc++.so.6']);
  const valid = 'Class: ELF64\n Machine: Advanced Micro Devices X86-64\n Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]\n (NEEDED) Shared library: [libatomic.so.1]\n (NEEDED) Shared library: [libc.so.6]\n (RUNPATH) Library runpath: [$ORIGIN/lib]\n Name: GLIBC_2.39';
  assert.doesNotThrow(() => validateElfInspection(file, root, valid, bundled));
  assert.doesNotThrow(() => validateElfInspection(`${root}/runtime/rg`, root, 'Class: ELF64\n Machine: Advanced Micro Devices X86-64\n There is no dynamic section in this file.', bundled));
  for (const invalid of [
    valid.replace('ELF64', 'ELF32'), valid.replace('Advanced Micro Devices X86-64', 'AArch64'),
    valid.replace('libatomic.so.1', 'libmissing.so.1'), valid.replace('ld-linux-x86-64.so.2', 'nix-loader.so'),
    valid.replace('$ORIGIN/lib', '/usr/lib'), valid.replace('$ORIGIN/lib', '$ORIGIN/../../outside'),
    valid.replace('GLIBC_2.39', 'GLIBC_2.40'), valid.replace('GLIBC_2.39', 'GLIBC_3.0'),
    valid.replace(' (RUNPATH) Library runpath: [$ORIGIN/lib]\n', ''),
  ]) assert.throws(() => validateElfInspection(file, root, invalid, bundled));
});

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
test('archive verifier rejects changed bytes and escaping links before running package commands', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-archive-boundary-' });
  const input = join(root, 'input');
  yield* fs.makeDirectory(input);
  const outside = join(root, 'outside');
  yield* fs.writeFileString(outside, 'untouched');
  yield* fs.symlink(outside, join(input, 'escape'));
  const target = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
  const archive = join(root, `concord-1.2.3-${target}.tar.gz`);
  yield* mustRun(['tar', '-czf', archive, '-C', input, 'escape'], { cwd: root, outputDir: root });
  const sums = join(root, 'SHA256SUMS');
  yield* fs.writeFileString(sums, `${'0'.repeat(64)}  concord-1.2.3-${target}.tar.gz\n`);
  const changed = yield* verifyReleaseArchive(archive, '1.2.3', sums).pipe(Effect.result);
  assert.equal(changed._tag, 'Failure');
  if (changed._tag === 'Failure') assert.match(String(changed.failure), /checksum differs/u);
  const digest = createHash('sha256').update(yield* fs.readFile(archive)).digest('hex');
  yield* fs.writeFileString(sums, `${digest}  concord-1.2.3-${target}.tar.gz\n`);
  const escaped = yield* verifyReleaseArchive(archive, '1.2.3', sums).pipe(Effect.result);
  assert.equal(escaped._tag, 'Failure');
  if (escaped._tag === 'Failure') assert.match(String(escaped.failure), /link escapes root/u);
  assert.equal(yield* fs.readFileString(outside), 'untouched');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#package
test('release assembly rejects nonportable or mismatched native inputs before assembling candidates', () => Effect.runPromise(Effect.gen(function*() {
  const { assembleRelease } = yield* Effect.promise(() => import('../../scripts/assemble-release.ts'));
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-release-inputs-' });
  for (const defect of ['nonportable', 'mismatched']) {
    const native = join(root, defect);
    for (const target of ['linux-x64-glibc', 'darwin-arm64']) {
      yield* fs.makeDirectory(join(native, target), { recursive: true });
      yield* fs.writeFileString(join(native, target, 'artifact.json'), JSON.stringify({
        target, abi: HAWDB_ABI, revision: HAWDB_REVISION, sourceDigest: (defect === 'mismatched' && target === 'darwin-arm64' ? 'b' : 'a').repeat(64),
        cargoLockDigest: 'c'.repeat(64), binarySha256: 'd'.repeat(64), noticesSha256: 'e'.repeat(64), portable: defect !== 'nonportable', testHooks: false,
      }));
    }
    const output = join(root, `${defect}-release`);
    const result = yield* assembleRelease(output, join(root, 'unused-app'), native).pipe(Effect.result);
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.match(String(result.failure), defect === 'nonportable' ? /portable production artifact/u : /source identities disagree/u);
    assert.deepEqual(yield* fs.readDirectory(output), [], 'no candidate should be assembled from rejected native inputs');
  }
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
