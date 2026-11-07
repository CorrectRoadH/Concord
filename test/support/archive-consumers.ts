import type * as NodeChildProcessTypes from 'node:child_process';
import { startViewServer } from '../e2e/server.ts';
import { waitForWorkspaceProjection, fetchFresh } from './support.ts';
import { execFileSync } from 'node:child_process';
import { installationResources } from '../../src/base/installation/index.ts';
import { packageBin } from './installed-package.ts';
import { hawdbTarget } from "../../src/base/installation/index.ts";
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join, resolve } from 'node:path';
import { packageCommand } from '../../scripts/package-command.ts';

import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { prepareSourceConsumer, builtConcord } from './installed-package.ts';
import { replaceInstalledNativeBinary } from '../../scripts/verify-installed-native.ts';

const archiveExec = (entry: string, args: readonly string[], options: NodeChildProcessTypes.ExecFileSyncOptionsWithStringEncoding) => {
  const [command, ...prefix] = packageCommand(entry);
  return execFileSync(command, [...prefix, ...args], { ...options, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', ...options.env } });
};

export async function verifyArchiveConsumers(packageRoot: string): Promise<void> {
const checks: { name: string; run: () => void | Promise<void> }[] = [];
const test = (name: string, run: () => void | Promise<void>) => { checks.push({ name, run }); };

// @feature docs/engineering/testing/README.md#检查入口
test('parallel consumers share the build while damage stays in a private copy', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-install-sharing-')));
  const original = process.env.CONCORD_TEST_INSTALLS;
  const installs = join(root, 'installs');
  try {
    const artifact = yield* Effect.sync(() => builtConcord(packageRoot));
    assert.equal(realpathSync(artifact.filename), realpathSync(packageRoot));
    assert.equal(existsSync(join(artifact.filename, 'src/entry/cli/entry.ts')), false, 'installed consumers must not execute checkout source');
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
      [resolve('test/fixtures/install-consumer.ts'), consumer, manifest],
      { env: { ...process.env, CONCORD_TEST_INSTALLS: installs }, stdout: 'inherit', stderr: 'inherit' }))), { concurrency: 'unbounded' });
    assert.deepEqual(codes.map(Number), [0, 0, 0]);
    const version = archiveExec(packageBin(join(consumers[0]!, 'node_modules/concord-sdlc')), ['--version'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
    assert.equal(version.trim(), `concord v${artifact.version}`);
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
      assert.notEqual(statSync(join(installationResources(join(consumers[0]!, 'node_modules/concord-sdlc')).native, hawdbTarget(), 'hawdb.node')).ino, statSync(join(installationResources(join(privateRoot, 'node_modules/concord-sdlc')).native, hawdbTarget(), 'hawdb.node')).ino,
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
    prepareSourceConsumer(root, builtConcord(packageRoot), [], { private: true });
    const installed = join(root, 'node_modules/concord-sdlc');
    const binary = join(installationResources(installed).native, hawdbTarget(), 'hawdb.node');
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    execFileSync('git', ['init', '-q', consumer]);
    archiveExec(packageBin(installed), ['--root', consumer, '--json', 'init', '--docs-only'], { encoding: 'utf8' });
    const server = await startViewServer({ root: consumer, installedBin: packageBin(installed) });
    try {
      await waitForWorkspaceProjection(server.address.replace(/\/$/u, ''));
      const page = await fetchFresh(server.address);
      assert.equal(page.status, 200, 'installed workspace service must serve the packaged Web entry');
      assert.match(await page.text(), /<!doctype html/iu);
      const bytes = readFileSync(binary), inode = statSync(binary).ino;
      await Effect.runPromise(replaceInstalledNativeBinary(binary, Buffer.concat([bytes, Buffer.from('digest mismatch')])).pipe(Effect.provide(NodeServices.layer)));
      assert.notEqual(statSync(binary).ino, inode, 'a mapped image must not be truncated');
      await Effect.runPromise(replaceInstalledNativeBinary(binary, bytes).pipe(Effect.provide(NodeServices.layer)));
      assert.equal((await fetchFresh(`${server.address}api/workspace`)).status, 200);
    } finally { await server.close(); }
    assert.equal(server.process.signalCode, null, 'mapped native finalizers must not crash shutdown');
    assert.equal(server.process.exitCode, 130, 'Effect reports the requested interruption after releasing native resources');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const check of checks) {
  try { await check.run(); } catch (cause) { throw new Error(`Archive consumer check failed: ${check.name}`, { cause }); }
}
}
