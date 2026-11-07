import assert from 'node:assert/strict';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { renderTypeScriptConfig, Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { createConsumer } from '../support/consumer.ts';

// @feature docs/feature/project-onboarding/README.md
test('Workspace opens immutable operation metadata without granting publication or retaining configuration', async () => {
  const root = createConsumer();
  const otherRoot = createConsumer();
  const privateFiles = () => existsSync(join(root, '.git/concord')) ? readdirSync(join(root, '.git/concord')).sort() : [];
  const before = privateFiles();
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const first = yield* workspace.open(root, { access: 'write', cache: 'off' });
      assert.equal(first.root, root);
      assert.equal(first.access, 'write');
      assert.equal(first.cache, 'off');
      assert.equal(Object.isFrozen(first), true);
      assert.equal('publish' in first, false);
      assert.equal('close' in first, false);
      assert.deepEqual(privateFiles(), before);
      const source = renderTypeScriptConfig({ sourceRoots: ['src'] });
      writeFileSync(join(root, 'concord.config.ts'), source);
      const second = yield* workspace.open(root, { access: 'read', cache: 'use' });
      assert.equal(second.configuration.source, source);
      assert.notEqual(first.configuration.digest, second.configuration.digest);
      assert.equal(first.access, 'write');
      const readRoot = Effect.map(WorkspaceContext, context => context.root);
      const other = yield* workspace.open(otherRoot, { access: 'read', cache: 'off' });
      const observed = yield* Effect.all([
        readRoot.pipe(Effect.provideService(WorkspaceContext, first)),
        readRoot.pipe(Effect.provideService(WorkspaceContext, other)),
      ], { concurrency: 'unbounded' });
      assert.deepEqual(observed, [root, otherRoot]);
    }).pipe(Effect.provide(Workspace.layer), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(otherRoot, { recursive: true, force: true }); }
});
