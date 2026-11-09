// 跨进程保证：外部程序——准备入口只消费固定发行二进制，缓存和下载成功、缺失或损坏均不得启动Cargo。
import { nativeArtifactRoot, readNativeRelease, nativeCacheRoot } from "../../src/base/installation/index.ts";
import { hawdbTarget, decodeNativeArtifact, HAWDB_MACOS_DEPLOYMENT_TARGET } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { privateSourceInstallation } from '../support/private-source.ts';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);


const release = readNativeRelease();
const target = hawdbTarget();
const original = join(nativeArtifactRoot(runtime), target);
const identity = Effect.runSync(Effect.sync(() => decodeNativeArtifact(JSON.parse(readFileSync(join(original, 'artifact.json'), 'utf8')))));
const args = (root: string) => ['scripts/prepare-native.ts', '--output', join(root, 'output')];
const cachePath = (root: string) => join(root, 'cache/concord/native', release.tag, target);
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-native-build-'));
  mkdirSync(join(root, 'bin'));
  // A compiler boundary probe proves every path stays binary-only.
  writeFileSync(join(root, 'bin/cargo'), '#!/bin/sh\ntouch \"$CARGO_PROBE\"\necho cargo-fallback-invoked >&2\nexit 43\n', { mode: 0o755 });
  return root;
};
const env = (root: string) => ({ ...process.env, MACOSX_DEPLOYMENT_TARGET: HAWDB_MACOS_DEPLOYMENT_TARGET, CONCORD_NATIVE_OFFLINE: '1', CARGO_PROBE: join(root, 'cargo-invoked'), XDG_CACHE_HOME: join(root, 'cache'), PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}` });

// @feature docs/engineering/build/README.md
test('CI prebuilt transfer loads in a fresh cache without Cargo and rejects corrupted or test-hook artifacts', () => Effect.runPromise(Effect.sync(() => {
  const root = setup();
  try {
    const incoming = join(root, 'incoming', target);
    cpSync(original, incoming, { recursive: true });
    const transfer = () => spawnSync(process.execPath, ['scripts/prepare-native.ts', '--prebuilt', join(root, 'incoming')], { env: env(root), encoding: 'utf8' });
    const installed = transfer();
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    assert.doesNotMatch(installed.stderr, /cargo-fallback-invoked|Native download/u);
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `import { createRequire } from 'node:module'; const native = createRequire(import.meta.url)(process.argv[1]); if (typeof native.CacheBridge !== 'function') throw new Error('Native bridge missing');` , join(cachePath(root), 'hawdb.node')], { encoding: 'utf8', env: env(root) });
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
    for (const mutation of [{ binarySha256: '0'.repeat(64) }, { sourceDigest: '0'.repeat(64) }, { testHooks: true }]) {
      writeFileSync(join(incoming, 'artifact.json'), JSON.stringify({ ...identity, ...mutation }));
      const rejected = transfer();
      assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
      assert.doesNotMatch(rejected.stderr, /cargo-fallback-invoked|Native download/u);
      assert.deepEqual(decodeNativeArtifact(JSON.parse(readFileSync(join(cachePath(root), 'artifact.json'), 'utf8'))), identity);
    }
    cpSync(join(nativeCacheRoot(runtime, true), target), incoming, { recursive: true });
    const hooks = spawnSync(process.execPath, ['scripts/prepare-native.ts', '--test-hooks', '--prebuilt', join(root, 'incoming')], { env: env(root), encoding: 'utf8' });
    assert.equal(hooks.status, 0, hooks.stdout + hooks.stderr);
    assert.equal(decodeNativeArtifact(JSON.parse(readFileSync(join(root, 'cache/concord/native', release.tag, 'test-hooks', target, 'artifact.json'), 'utf8'))).testHooks, true);
    assert.equal(decodeNativeArtifact(JSON.parse(readFileSync(join(cachePath(root), 'artifact.json'), 'utf8'))).testHooks, false);
    assert.equal(transfer().status, 1);
    assert.equal(existsSync(join(root, 'cargo-invoked')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('native cache validates the complete identity and skips all network/compiler work on a hit', () => Effect.runPromise(Effect.sync(() => {
  const root = setup();
  try {
    cpSync(original, cachePath(root), { recursive: true });
    const hit = spawnSync(process.execPath, args(root), { env: env(root), encoding: 'utf8' });
    assert.equal(hit.status, 0, hit.stdout + hit.stderr);
    assert.match(hit.stderr, /Native cache hit/);
    assert.doesNotMatch(hit.stderr, /cargo-fallback-invoked|Native download/);
    assert.deepEqual(readFileSync(join(root, 'output', target, 'hawdb.node')), readFileSync(join(original, 'hawdb.node')));
    for (const mutation of [
      { target: target === 'darwin-arm64' ? 'linux-x64-glibc' : 'darwin-arm64' }, { abi: identity.abi + '-invalid' }, { revision: '0'.repeat(40) }, { sourceDigest: '0'.repeat(64) },
      { cargoLockDigest: '0'.repeat(64) }, { binarySha256: '0'.repeat(64) }, { noticesSha256: '0'.repeat(64) },
      { testHooks: true },
    ]) {
      writeFileSync(join(cachePath(root), 'artifact.json'), JSON.stringify({ ...identity, ...mutation }));
      const result = spawnSync(process.execPath, args(root), { env: env(root), encoding: 'utf8' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /Native cache: .*trying fixed release/);
      assert.match(result.stdout + result.stderr, /CONCORD_NATIVE_OFFLINE=1/);
      assert.doesNotMatch(result.stderr, /cargo-fallback-invoked/);
      assert.equal(existsSync(join(root, 'cargo-invoked')), false);
    }
    const binary = join(cachePath(root), 'hawdb.node'), savedBinary = readFileSync(binary);
    writeFileSync(binary, 'tampered binary');
    writeFileSync(join(cachePath(root), 'artifact.json'), JSON.stringify({ ...identity, binarySha256: createHash('sha256').update('tampered binary').digest('hex') }));
    const selfConsistentCorruption = spawnSync(process.execPath, args(root), { env: env(root), encoding: 'utf8' });
    assert.equal(selfConsistentCorruption.status, 1);
    assert.match(selfConsistentCorruption.stderr, /native release\/mode mismatch/u);
    assert.equal(existsSync(join(root, 'cargo-invoked')), false);
    writeFileSync(binary, savedBinary);
    writeFileSync(join(cachePath(root), 'artifact.json'), JSON.stringify(identity));
    const dependency = readdirSync(join(cachePath(root), 'licenses'))[0]!;
    const dependencyLicense = readdirSync(join(cachePath(root), 'licenses', dependency))[0]!;
    for (const file of [join(cachePath(root), 'HAWDB-LICENSE.txt'), join(cachePath(root), 'licenses', dependency, dependencyLicense)]) {
      const before = readFileSync(file);
      chmodSync(file, 0o644);
      writeFileSync(file, 'corrupt license bytes');
      const result = spawnSync(process.execPath, args(root), { env: env(root), encoding: 'utf8' });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /native license digest mismatch/);
      assert.doesNotMatch(result.stderr, /cargo-fallback-invoked/);
      assert.equal(existsSync(join(root, 'cargo-invoked')), false);
      writeFileSync(file, before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('pinned native download verifies archive bytes and never invokes Cargo on corruption or absence', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* Effect.sync(setup);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let responseMode: 'valid' | 'corrupt' | 'missing' = 'valid';
  const requested: string[] = [];
  const archive = join(root, 'native.tar.gz');
  yield* Effect.sync(() => execFileSync('tar', ['-czf', archive, '-C', nativeArtifactRoot(runtime), target], { env: { ...process.env, COPYFILE_DISABLE: '1' } }));
  const fixtureRoot = join(root, 'checkout');
  yield* Effect.sync(() => {
    privateSourceInstallation(fixtureRoot);
    const pin = JSON.parse(readFileSync(join(fixtureRoot, 'native-release.json'), 'utf8')) as { assets: { target: string; testHooks: boolean; archiveSha256: string }[] };
    pin.assets.find(asset => asset.target === target && !asset.testHooks)!.archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(join(fixtureRoot, 'native-release.json'), JSON.stringify(pin));
  });
  const server = createServer((request, response) => {
    requested.push(request.url ?? '');
    response.statusCode = responseMode === 'missing' ? 404 : 200;
    response.end(responseMode === 'valid' ? readFileSync(archive) : Buffer.from(responseMode));
  });
  yield* Effect.promise(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const options = { cwd: fixtureRoot, env: { ...env(root), CONCORD_NATIVE_OFFLINE: '0', CONCORD_NATIVE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}/releases` } };
    const result = yield* spawner.string(ChildProcess.make(process.execPath, args(root), { ...options, stderr: 'inherit' }));
    assert.equal(result.trim(), '');
    assert.deepEqual(requested, [`/releases/${release.tag}/hawdb-${target}.tar.gz`]);
    assert.equal(existsSync(join(cachePath(root), 'artifact.json')), true);
    assert.deepEqual(decodeNativeArtifact(JSON.parse(readFileSync(join(cachePath(root), 'artifact.json'), 'utf8'))), identity);
    yield* Effect.sync(() => rmSync(join(root, 'cache'), { recursive: true, force: true }));
    for (const mode of ['corrupt', 'missing'] as const) {
      responseMode = mode;
      const code = yield* spawner.exitCode(ChildProcess.make(process.execPath, args(root), { ...options, stdout: 'inherit', stderr: 'inherit' }));
      assert.equal(Number(code), 1);
      assert.equal(existsSync(join(cachePath(root), 'artifact.json')), false);
      assert.equal(existsSync(join(root, 'cargo-invoked')), false);
    }
    assert.equal(requested.length, 3);
  } finally {
    yield* Effect.promise(() => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }));
    yield* Effect.sync(() => rmSync(root, { recursive: true, force: true }));
  }
})).pipe(Effect.provide(NodeServices.layer))));
