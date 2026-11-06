import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { assembleArchive, launcher } from '../../scripts/archive.ts';
import { archiveTarget, UnsupportedTarget } from '../../scripts/archive-support.ts';
import { assertGlibcBaseline, parseElf } from '../../scripts/archive-linux.ts';

// @feature docs/engineering/build/cli.md#错误
test('unsupported archive targets fail before creating or replacing any output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'concord-archive-target-'));
  try {
    for (const value of ['', 'linux-arm64', 'darwin-x64', { target: 'linux-x64' }]) {
      assert.throws(() => archiveTarget(value), UnsupportedTarget);
      await assert.rejects(Effect.runPromise(assembleArchive({ target: value, applicationRoot: '/missing', outputRoot: join(root, 'output') }).pipe(Effect.provide(NodeServices.layer))), /Unsupported target/);
      assert.deepEqual(await readdir(root), []);
    }
  } finally { await rm(root, { recursive: true }); }
});

// @feature docs/feature/cross-platform-release/architecture.md#linux-运行库
test('ELF inspection recognizes static images, dependencies, paths and the GLIBC ceiling', () => {
  assert.equal(parseElf('There is no dynamic section in this file.').dynamic, false);
  assert.equal(parseElf('Dynamic section at offset 0x123 contains 16 entries:\n (RELA) 0x200').dynamic, false, 'static PIE relocation metadata is not dynamic linkage');
  const info = parseElf('Dynamic section at offset\n (NEEDED) Shared library: [libatomic.so.1]\n (RPATH) Library rpath: [$ORIGIN/lib]\n [Requesting program interpreter: /lib64/ld-linux-x86-64.so.2]\n Name: GLIBC_2.39');
  assert.deepEqual(info.needed, ['libatomic.so.1']);
  assert.deepEqual(info.paths, ['$ORIGIN/lib']);
  assert.equal(info.interpreter, '/lib64/ld-linux-x86-64.so.2');
  assert.doesNotThrow(() => assertGlibcBaseline('GLIBC_2.39 GLIBC_2.2.5', 'node'));
  assert.throws(() => assertGlibcBaseline('GLIBC_2.42', 'addon.node'), /newer than 2.39/);
});

// @feature docs/feature/cross-platform-release/architecture.md#归档构成
test('launcher delegates only to packaged node and preserves process arguments', () => {
  assert.ok(launcher.includes('exec "$root/runtime/node" "$root/app/dist/entry/cli/entry.js" "$@"'));
  assert.ok(launcher.includes('PackagedRuntimeUnavailable'));
  assert.equal(launcher.includes('LD_LIBRARY_PATH'), false);
});
