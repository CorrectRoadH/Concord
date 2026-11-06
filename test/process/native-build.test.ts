import { nativeArtifactRoot } from "../../src/base/installation/index.ts";
import { hawdbTarget, decodeNativeArtifact, HAWDB_MACOS_DEPLOYMENT_TARGET } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);


const target = hawdbTarget();
const original = join(nativeArtifactRoot(runtime), target);
const identity = Effect.runSync(Effect.sync(() => decodeNativeArtifact(JSON.parse(readFileSync(join(original, 'artifact.json'), 'utf8')))));
const args = (root: string) => ['scripts/build-native.ts', '--reuse', '--output', join(root, 'output')];
const cachePath = (root: string) => join(root, 'cache/concord/native', `${identity.sourceDigest}-${identity.cargoLockDigest}`, target);
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-native-build-'));
  mkdirSync(join(root, 'bin'));
  // Cargo is an external compiler boundary. A fallback must reach it and retain
  // its failure, without rebuilding or altering the suite's frozen dist.
  writeFileSync(join(root, 'bin/cargo'), '#!/bin/sh\necho cargo-fallback-invoked >&2\nexit 43\n', { mode: 0o755 });
  return root;
};
const env = (root: string) => ({ ...process.env, MACOSX_DEPLOYMENT_TARGET: HAWDB_MACOS_DEPLOYMENT_TARGET, CONCORD_NATIVE_OFFLINE: '1', XDG_CACHE_HOME: join(root, 'cache'), PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}` });

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
      assert.match(result.stderr, /Native cache: .*falling back/);
      assert.match(result.stderr, /CONCORD_NATIVE_OFFLINE=1/);
      assert.match(result.stderr, /cargo-fallback-invoked/);
    }
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
      assert.match(result.stderr, /cargo-fallback-invoked/);
      writeFileSync(file, before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

test('native per-digest download populates the cache and invalid archives fall back honestly', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* Effect.sync(setup);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let corrupt = false;
  const requested: string[] = [];
  const archive = join(root, 'native.tar.gz');
  yield* Effect.sync(() => execFileSync('tar', ['-czf', archive, '-C', nativeArtifactRoot(runtime), target], { env: { ...process.env, COPYFILE_DISABLE: '1' } }));
  const server = createServer((request, response) => {
    requested.push(request.url ?? '');
    response.end(corrupt ? Buffer.from('invalid archive') : readFileSync(archive));
  });
  yield* Effect.promise(async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const options = { env: { ...env(root), CONCORD_NATIVE_OFFLINE: '0', CONCORD_NATIVE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}/releases` } };
    const result = yield* spawner.string(ChildProcess.make(process.execPath, args(root), { ...options, stderr: 'inherit' }));
    assert.equal(result.trim(), '');
    assert.deepEqual(requested, [`/releases/native-${identity.sourceDigest.slice(0, 16)}/concord-native-${target}.tar.gz`]);
    assert.equal(existsSync(join(cachePath(root), 'artifact.json')), true);
    assert.deepEqual(decodeNativeArtifact(JSON.parse(readFileSync(join(cachePath(root), 'artifact.json'), 'utf8'))), identity);
    yield* Effect.sync(() => rmSync(join(root, 'cache'), { recursive: true, force: true }));
    corrupt = true;
    const code = yield* spawner.exitCode(ChildProcess.make(process.execPath, args(root), { ...options, stdout: 'inherit', stderr: 'inherit' }));
    assert.equal(Number(code), 1);
    assert.equal(requested.length, 2);
    assert.equal(existsSync(join(cachePath(root), 'artifact.json')), false);
  } finally {
    yield* Effect.promise(() => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }));
    yield* Effect.sync(() => rmSync(root, { recursive: true, force: true }));
  }
})).pipe(Effect.provide(NodeServices.layer))));
