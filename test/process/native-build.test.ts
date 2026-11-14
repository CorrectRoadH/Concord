// 跨进程保证：外部程序——固定官方制品准备拒绝损坏与不安全归档，离线命中不执行编译器。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadHawDB } from '@nowledge/hawdb-bun';
import test from 'node:test';
import { Effect } from 'effect';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { hawdbLibraryName, hawdbTarget, decodeNativeArtifact } from '../../src/base/installation/hawdb-native-contract.ts';
import { nativeArtifactRoot, nativeFileIdentity, verifyNativeArtifactDirectory, verifiedHawdbLibrary } from '../../src/base/installation/native-artifact.ts';
import { readNativeRelease, decodeNativeRelease, nativeReleaseAsset } from '../../src/base/installation/native-release.ts';
import { privateSourceInstallation } from '../support/private-source.ts';
import { tmpdir } from '../support/temporary.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const release = readNativeRelease(), target = hawdbTarget(), expected = nativeReleaseAsset(release, target);
const original = join(nativeArtifactRoot(runtime), target);
const receipt = decodeNativeArtifact(JSON.parse(readFileSync(join(original, 'artifact.json'), 'utf8')));
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-native-build-'));
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'bin/cargo'), '#!/bin/sh\ntouch "$CARGO_PROBE"\nexit 43\n', { mode: 0o755 });
  return root;
};
const environment = (root: string) => ({ ...process.env, CONCORD_NATIVE_OFFLINE: '1', XDG_CACHE_HOME: join(root, 'cache'), CARGO_PROBE: join(root, 'cargo-invoked'), PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}` });
const cachePath = (root: string) => join(root, 'cache/concord/native', release.tag, target);
const invoke = (root: string, args: string[]) => spawnSync(process.execPath, ['scripts/prepare-native.ts', ...args], { env: environment(root), encoding: 'utf8' });

// @feature docs/engineering/build/README.md
test('official release pin rejects mismatched targets, duplicate assets and legacy metadata', () => {
  assert.equal(decodeNativeRelease(release).tag, 'v0.31.0');
  for (const mutation of [{ format: 'concord.native-release/v1' }, { repository: 'other/hawdb' }, { tag: 'hawdb-0.31.0' }, { abi: 'bridge' }, { assets: [release.assets[0], release.assets[0]] }, { assets: release.assets.map(asset => ({ ...asset, upstreamTarget: 'wrong' })) }]) {
    assert.throws(() => decodeNativeRelease({ ...release, ...mutation }));
  }
});

// @feature docs/engineering/build/README.md
test('prebuilt transfer and offline cache preserve official bytes, load identity and reject every tampered member', () => Effect.runPromise(Effect.sync(() => {
  const root = setup(), incoming = join(root, 'incoming', target);
  try {
    cpSync(original, incoming, { recursive: true });
    const transfer = () => invoke(root, ['--prebuilt', join(root, 'incoming'), '--require-portable']);
    let result = transfer();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verified = verifiedHawdbLibrary(makeRuntimeEnvironment(root, environment(root)));
    assert.equal(verified.identity, nativeFileIdentity(verified.binary));
    assert.equal(verified.version, release.version);
    const library = loadHawDB(verified.binary);
    try {
      assert.equal(library.version(), `hawdb ${verified.version}`);
      assert.equal(nativeFileIdentity(verified.binary), verified.identity);
    } finally { library.close(); }
    result = invoke(root, ['--output', join(root, 'output')]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /Native cache hit/u);
    assert.deepEqual(readFileSync(join(root, 'output', target, hawdbLibraryName(target))), readFileSync(join(original, hawdbLibraryName(target))));
    for (const mutation of [{ upstreamManifestSha256: '0'.repeat(64) }, { binarySha256: '0'.repeat(64) }, { target: 'other' }, { abi: 'fake' }]) {
      writeFileSync(join(incoming, 'artifact.json'), JSON.stringify({ ...receipt, ...mutation }));
      assert.equal(transfer().status, 1);
      assert.deepEqual(JSON.parse(readFileSync(join(cachePath(root), 'artifact.json'), 'utf8')), receipt);
    }
    writeFileSync(join(incoming, 'artifact.json'), JSON.stringify(receipt));
    const outside = join(root, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'keep'), 'owned elsewhere');
    rmSync(join(cachePath(root), 'lib'), { recursive: true }); symlinkSync(outside, join(cachePath(root), 'lib'));
    result = transfer(); assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'owned elsewhere');
    for (const member of ['manifest.json', 'include/hawdb_ffi.h', 'LICENSE', 'lib/libhawdb_ffi.a', hawdbLibraryName(target)]) {
      const file = join(incoming, member), bytes = readFileSync(file);
      writeFileSync(file + '.next', 'damaged'); renameSync(file + '.next', file);
      assert.equal(transfer().status, 1, member);
      writeFileSync(file + '.next', bytes); renameSync(file + '.next', file);
    }
    const binary = join(incoming, hawdbLibraryName(target));
    writeFileSync(binary + '.next', 'fake'); renameSync(binary + '.next', binary);
    writeFileSync(join(incoming, 'artifact.json'), JSON.stringify({ ...receipt, binarySha256: digest('fake') }));
    assert.equal(transfer().status, 1, 'self-consistent receipt must not replace source trust');
    assert.equal(existsSync(join(root, 'cargo-invoked')), false);
    assert.equal(invoke(root, ['--test-hooks']).status, 1);
    assert.equal(invoke(root, ['--all-modes']).status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/engineering/build/README.md
test('offline missing and corrupt caches fail without compiler or download; path links and unknown members fail', () => Effect.runPromise(Effect.sync(() => {
  const root = setup();
  try {
    const prepare = () => invoke(root, []);
    assert.equal(prepare().status, 1);
    cpSync(original, cachePath(root), { recursive: true });
    const license = join(cachePath(root), 'LICENSE');
    rmSync(license); symlinkSync(join(original, 'LICENSE'), license);
    assert.throws(() => verifyNativeArtifactDirectory(cachePath(root), target), /non-regular/u);
    assert.equal(prepare().status, 1);
    rmSync(license); cpSync(join(original, 'LICENSE'), license);
    writeFileSync(join(cachePath(root), 'untrusted'), 'extra');
    assert.equal(prepare().status, 1);
    assert.equal(existsSync(join(root, 'cargo-invoked')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/engineering/build/README.md
test('download validates archive digest before extraction and rejects unknown, duplicate and linked archive members', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = setup(), checkout = join(root, 'checkout'), prefix = expected.name.replace(/\.tar\.gz$/u, '');
  privateSourceInstallation(checkout);
  const content = join(root, 'content'); mkdirSync(content);
  cpSync(original, join(content, prefix), { recursive: true }); rmSync(join(content, prefix, 'artifact.json'));
  const archive = join(root, 'native.tar.gz');
  const pack = (members = [prefix]) => execFileSync('tar', ['-czf', archive, '-C', content, ...members], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  pack();
  let response = readFileSync(archive), requests = 0;
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => { requests++; return new Response(response); } });
  const run = async (trustArchive = true) => {
    rmSync(join(root, 'cache'), { recursive: true, force: true });
    const pin = JSON.parse(JSON.stringify(release)) as { assets: { target: string; archiveSha256: string }[] };
    if (trustArchive) pin.assets.find(asset => asset.target === target)!.archiveSha256 = digest(response);
    writeFileSync(join(checkout, 'native-release.json'), JSON.stringify(pin));
    const child = Bun.spawn([process.execPath, 'scripts/prepare-native.ts'], { cwd: checkout, env: { ...environment(root), CONCORD_NATIVE_OFFLINE: '0', CONCORD_NATIVE_RELEASE_BASE_URL: `http://127.0.0.1:${server.port}` }, stdout: 'pipe', stderr: 'pipe' });
    const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { status, output: stdout + stderr };
  };
  try {
    let result = await run();
    assert.equal(result.status, 0, result.output);
    response = Buffer.from('corrupt'); result = await run(false);
    assert.equal(result.status, 1); assert.match(result.output, /archive checksum mismatch/u);
    writeFileSync(join(content, prefix, 'unknown'), 'unknown'); pack(); response = readFileSync(archive);
    result = await run(); assert.equal(result.status, 1); assert.match(result.output, /archive paths/u);
    rmSync(join(content, prefix, 'unknown'));
    pack([prefix, `${prefix}/LICENSE`]); response = readFileSync(archive);
    result = await run(); assert.equal(result.status, 1); assert.match(result.output, /archive paths/u);
    const traversal = Buffer.alloc(1536);
    traversal.write('0000755\0', 100); traversal.write('0000000\0', 108); traversal.write('0000000\0', 116);
    traversal.write('00000000000\0', 124); traversal.write('00000000000\0', 136); traversal.write('5', 156);
    traversal.fill(0, 0, 100); traversal.write('../escape/', 0);
    traversal.fill(32, 148, 156);
    const checksum = traversal.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    traversal.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    response = gzipSync(traversal);
    result = await run(); assert.equal(result.status, 1); assert.match(result.output, /archive paths/u);
    rmSync(join(content, prefix, 'LICENSE')); symlinkSync('../outside', join(content, prefix, 'LICENSE'));
    pack(); response = readFileSync(archive);
    result = await run(); assert.equal(result.status, 1); assert.match(result.output, /links or special/u);
    assert.equal(requests, 6);
    assert.equal(existsSync(join(root, 'cargo-invoked')), false);
    assert.equal(existsSync(join(cachePath(root), 'artifact.json')), false);
  } finally { await server.stop(true); rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/engineering/build/README.md
test('installed Linux relocation binds only final binary bytes while preserving official provenance; Darwin stays exact', () => Effect.runPromise(Effect.sync(() => {
  const root = setup(), folder = join(root, target);
  try {
    cpSync(original, folder, { recursive: true });
    const binary = join(folder, hawdbLibraryName(target));
    writeFileSync(binary + '.next', 'private relocated library'); renameSync(binary + '.next', binary);
    writeFileSync(join(folder, 'artifact.json'), JSON.stringify({ ...receipt, binarySha256: digest('private relocated library') }));
    assert.throws(() => verifyNativeArtifactDirectory(folder, target, true));
    if (target === 'linux-x64-glibc') {
      const installed = verifyNativeArtifactDirectory(folder, target, false);
      assert.equal(installed.identity, nativeFileIdentity(binary));
      assert.equal(installed.version, release.version);
      assert.equal(digest(readFileSync(join(folder, 'manifest.json'))), expected.manifestSha256);
      writeFileSync(join(folder, 'LICENSE'), 'untrusted');
      assert.throws(() => verifyNativeArtifactDirectory(folder, target, false));
    } else assert.throws(() => verifyNativeArtifactDirectory(folder, target, false));
    assert.equal(digest(readFileSync(join(original, hawdbLibraryName(target)))), expected.binarySha256);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/engineering/build/README.md
test('official manifest strict semantics reject a repinned feature profile, requirements, ABI or unknown member', () => Effect.runPromise(Effect.sync(() => {
  const root = setup(), folder = join(root, target);
  try {
    cpSync(original, folder, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(original, 'manifest.json'), 'utf8'));
    for (const mutation of [
      { version: '0.30.0' }, { engine_revision: '0'.repeat(40) }, { feature_profile: { name: 'minimal', features: [] } },
      { abi: { ...manifest.abi, retained_abi_version: 2 } }, { requirements: { ...manifest.requirements, os: 'wrong' } },
      { files: { ...manifest.files, '../escape': manifest.files.LICENSE } }, { extra: true },
    ]) {
      const bytes = JSON.stringify({ ...manifest, ...mutation }), manifestSha256 = digest(bytes);
      writeFileSync(join(folder, 'manifest.json'), bytes);
      writeFileSync(join(folder, 'artifact.json'), JSON.stringify({ ...receipt, upstreamManifestSha256: manifestSha256 }));
      const pin = { ...release, assets: release.assets.map(asset => asset.target === target ? { ...asset, manifestSha256 } : asset) };
      assert.throws(() => verifyNativeArtifactDirectory(folder, target, true, pin));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
