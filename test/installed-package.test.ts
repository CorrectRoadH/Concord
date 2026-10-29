import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { installConcord, packConcord } from './installed-package.js';

test('parallel consumers share one installed dependency set while damage stays in a private copy', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = yield* Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-install-sharing-')));
  const original = process.env.CONCORD_TEST_INSTALLS;
  const installs = join(root, 'installs');
  try {
    const artifact = yield* Effect.sync(() => packConcord(root));
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
    assert.equal(readdirSync(installs).length, 1);
    const frozen = yield* spawner.exitCode(ChildProcess.make('pnpm',
      ['install', '--lockfile-only', '--offline', '--frozen-lockfile', '--ignore-scripts'],
      { cwd: consumers[0]!, stdout: 'inherit', stderr: 'inherit' }));
    assert.equal(Number(frozen), 0, 'the consumer manifest and rebased lock must remain a valid frozen dependency set');
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
      installConcord(privateRoot, artifact, [], { private: true });
      const shared = join(consumers[0]!, 'node_modules/concord-sdlc/dist/entry.js');
      const privateFile = join(privateRoot, 'node_modules/concord-sdlc/dist/entry.js');
      assert.notEqual(statSync(shared).ino, statSync(privateFile).ino);
      const before = readFileSync(shared);
      writeFileSync(privateFile, 'damaged private installation');
      assert.deepEqual(readFileSync(shared), before);
      assert.equal(readdirSync(installs).length, 1);
      const withEffect = join(root, 'with-effect'); mkdirSync(withEffect);
      writeFileSync(join(withEffect, 'package.json'), '{"private":true}');
      installConcord(withEffect, artifact, ['effect@4.0.0-rc.112']);
      assert.equal(readdirSync(installs).length, 2, 'a distinct declared dependency set receives its own install');
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
