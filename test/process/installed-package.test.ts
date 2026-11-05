import { startViewServer } from '../e2e/server.js';
import { waitForWorkspaceProjection, fetchFresh } from '../support/support.js';
import { execFileSync } from 'node:child_process';
import { installationResources } from "../../src/base/installation/index.js";
import { relative } from "node:path";
import { packageBin } from '../../scripts/package-location.js';
import { hawdbTarget } from "../../src/base/installation/index.js";
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { prepareSourceConsumer, sourceConcord } from '../support/installed-package.js';
import { replaceInstalledNativeBinary } from '../../scripts/verify-installed-native.js';

import { pollUntil } from '../support/support.js';

test('parallel consumers share the build while damage stays in a private copy', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-install-sharing-')));
  const original = process.env.CONCORD_TEST_INSTALLS;
  const installs = join(root, 'installs');
  try {
    const artifact = yield* Effect.sync(() => sourceConcord());
    const manifest = join(root, 'artifact.json');
    const consumers = ['one', 'two', 'three'].map(name => join(root, name));
    yield* Effect.sync(() => {
      writeFileSync(manifest, JSON.stringify(artifact));
      for (const consumer of consumers) {
        mkdirSync(consumer);
        writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: consumer.split('/').at(-1), private: true, type: 'module' }));
      }
    });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const codes = yield* Effect.all(consumers.map(consumer => spawner.exitCode(ChildProcess.make(process.execPath,
      ['--import', 'tsx', resolve('test/fixtures/install-consumer.ts'), consumer, manifest],
      { env: { ...process.env, CONCORD_TEST_INSTALLS: installs }, stdout: 'inherit', stderr: 'inherit' }))), { concurrency: 'unbounded' });
    assert.deepEqual(codes.map(Number), [0, 0, 0]);
    assert.equal(new Set(consumers.map(consumer => realpathSync(join(consumer, 'node_modules/concord-sdlc')))).size, 1);
    assert.equal(existsSync(join(consumers[0]!, 'node_modules/effect')), false, 'consumers cannot import undeclared transitive dependencies');
    assert.notEqual(realpathSync(join(consumers[0]!, 'node_modules')), realpathSync(join(consumers[1]!, 'node_modules')));
    assert.notEqual(realpathSync(join(consumers[0]!, 'package.json')), realpathSync(join(consumers[1]!, 'package.json')));
    yield* Effect.sync(() => {
      process.env.CONCORD_TEST_INSTALLS = installs;
      mkdirSync(join(consumers[0]!, 'node_modules/.vite'));
      writeFileSync(join(consumers[0]!, 'node_modules/.vite/cache'), 'consumer-owned runner cache');
      assert.equal(existsSync(join(consumers[1]!, 'node_modules/.vite/cache')), false);
      const privateRoot = join(root, 'private'); mkdirSync(privateRoot);
      writeFileSync(join(privateRoot, 'package.json'), '{"private":true}');
      prepareSourceConsumer(privateRoot, artifact, [], { private: true });
      const shared = packageBin(join(consumers[0]!, 'node_modules/concord-sdlc'));
      const privateFile = packageBin(join(privateRoot, 'node_modules/concord-sdlc'));
      assert.notEqual(statSync(shared).ino, statSync(privateFile).ino);
      const nativeFile = join('node_modules/concord-sdlc', relative(join(consumers[0]!, 'node_modules/concord-sdlc'), installationResources(join(consumers[0]!, 'node_modules/concord-sdlc')).native), hawdbTarget(), 'hawdb.node');
      assert.notEqual(statSync(join(consumers[0]!, nativeFile)).ino, statSync(join(privateRoot, nativeFile)).ino,
        'native damage fixtures cannot share the mapped library inode with read-only consumers');
      const before = readFileSync(shared);
      writeFileSync(privateFile, 'damaged private installation');
      assert.deepEqual(readFileSync(shared), before);
      const withEffect = join(root, 'with-effect'); mkdirSync(withEffect);
      writeFileSync(join(withEffect, 'package.json'), '{"private":true}');
      prepareSourceConsumer(withEffect, artifact, ['effect@4.0.0-rc.112']);
      assert.equal(existsSync(join(withEffect, 'node_modules/effect')), true);
      assert.equal(existsSync(join(consumers[0]!, 'node_modules/effect')), false);
    });
  } finally {
    yield* Effect.sync(() => {
      if (original === undefined) delete process.env.CONCORD_TEST_INSTALLS;
      else process.env.CONCORD_TEST_INSTALLS = original;
      rmSync(root, { recursive: true, force: true });
    });
  }
})).pipe(Effect.provide(NodeServices.layer))));

test('native installation damage and repair preserve an image already mapped by a consumer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-mapped-install-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"private":true}');
    prepareSourceConsumer(root, sourceConcord(), [], { private: true });
    const installed = join(root, 'node_modules/concord-sdlc');
    const binary = join(installationResources(installed).native, hawdbTarget(), 'hawdb.node');
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    execFileSync('git', ['init', '-q', consumer]);
    execFileSync(process.execPath, [packageBin(installed), '--root', consumer, '--json', 'init', '--docs-only'], { encoding: 'utf8' });
    const server = await startViewServer({ root: consumer, installedBin: packageBin(installed) });
    try {
      await waitForWorkspaceProjection(server.address.replace(/\/$/u, ''));
      const bytes = readFileSync(binary), inode = statSync(binary).ino;
      replaceInstalledNativeBinary(binary, Buffer.concat([bytes, Buffer.from('digest mismatch')]));
      assert.notEqual(statSync(binary).ino, inode, 'a mapped image must not be truncated');
      replaceInstalledNativeBinary(binary, bytes);
      assert.equal((await fetchFresh(`${server.address}api/workspace`)).status, 200);
    } finally { await server.close(); }
    assert.equal(server.process.signalCode, null, 'mapped native finalizers must not crash shutdown');
    assert.equal(server.process.exitCode, 130, 'Effect reports the requested interruption after releasing native resources');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
