import assert from 'node:assert/strict';
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { renderTypeScriptConfig, Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { Sources, SourceSnapshot } from '../../src/base/sources/index.ts';
import { createConsumer } from '../support/consumer.ts';

const live = Layer.merge(Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('Effect projection observations retain an asynchronous candidate and collect drift before revoking its scope', async () => {
  const root = createConsumer();
  writeFileSync(join(root, 'docs/README.md'), '# Captured\n');
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources;
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'off' });
      const read = yield* Deferred.make<void>(), proceed = yield* Deferred.make<void>();
      let identity: SourceSnapshot['Service'] | undefined;
      const fiber = yield* Effect.forkChild(sources.observeProjection(Effect.gen(function*() {
        identity = yield* SourceSnapshot;
        const source = yield* sources.snapshot(sources.read('docs/README.md'));
        yield* sources.inspect('docs/README.md');
        yield* sources.inspect('docs/added.md');
        yield* sources.files('docs');
        yield* sources.rootFiles;
        yield* Deferred.succeed(read, undefined);
        yield* Deferred.await(proceed);
        return source;
      })).pipe(Effect.provideService(WorkspaceContext, context)));
      yield* Deferred.await(read);
      writeFileSync(join(root, 'docs/README.md'), '# Changed candidate input\n');
      chmodSync(join(root, 'docs/README.md'), 0o600);
      writeFileSync(join(root, 'docs/added.md'), '# Added\n');
      writeFileSync(join(root, 'added.txt'), 'root membership changed\n');
      yield* Deferred.succeed(proceed, undefined);
      const result = yield* Fiber.join(fiber);
      assert.equal(result.value, '# Captured\n');
      assert(result.drift.files.includes('docs/README.md'));
      assert(result.drift.files.includes('docs/added.md'));
      assert(result.drift.directories.includes('docs'));
      assert(result.drift.directories.includes('.'));
      const closed = yield* Effect.result(sources.read('docs/README.md').pipe(Effect.provideService(SourceSnapshot, identity!)));
      assert.equal(closed._tag, 'Failure');
      if (closed._tag === 'Failure') assert.equal(closed.failure.code, 'OperationFailed');
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('projection observations preserve the independent snapshot requirement', async () => {
  const root = createConsumer();
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const sources = yield* Sources;
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'off' });
      let evaluated = false;
      const result = yield* sources.snapshot(Effect.result(sources.observeProjection(Effect.sync(() => { evaluated = true; })))).pipe(Effect.provideService(WorkspaceContext, context));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'InvalidProjectionRead');
      assert.equal(evaluated, false);
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources shares nested observations and revokes snapshot reads after success and failure', async () => {
  const root = createConsumer();
  writeFileSync(join(root, 'docs/README.md'), '# Original\n');
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources;
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'off' });
      const snapshot = <A, E, R>(operation: Effect.Effect<A, E, R>) => sources.snapshot(operation).pipe(Effect.provideService(WorkspaceContext, context));
      const first = yield* snapshot(Effect.gen(function*() {
        const identity = yield* SourceSnapshot;
        assert.equal((yield* WorkspaceContext).root, root);
        assert.equal(yield* sources.read('docs/README.md'), '# Original\n');
        const nested = yield* snapshot(SourceSnapshot);
        assert.equal(nested, identity);
        return identity;
      }));
      const closed = yield* sources.read('docs/README.md').pipe(Effect.provideService(SourceSnapshot, first), Effect.result);
      assert.equal(closed._tag, 'Failure');
      if (closed._tag === 'Failure') assert.equal(closed.failure.code, 'OperationFailed');
      let failed: SourceSnapshot['Service'] | undefined;
      const drift = yield* snapshot(Effect.gen(function*() {
        failed = yield* SourceSnapshot;
        yield* sources.read('docs/README.md');
        writeFileSync(join(root, 'docs/README.md'), '# Changed\n');
      })).pipe(Effect.result);
      assert.equal(drift._tag, 'Failure');
      if (drift._tag === 'Failure') assert.equal(drift.failure.code, 'SourceChanged');
      assert.ok(failed);
      const rejected = yield* sources.read('docs/README.md').pipe(Effect.provideService(SourceSnapshot, failed), Effect.result);
      assert.equal(rejected._tag, 'Failure');
      assert.equal(yield* snapshot(sources.read('docs/README.md')), '# Changed\n');
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources rejects stale workspace configuration before evaluating the operation', async () => {
  const root = createConsumer();
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const stale = yield* workspace.open(root, { access: 'read', cache: 'off' });
      writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig({ sourceRoots: ['src'] }));
      let evaluated = false;
      const result = yield* sources.snapshot(Effect.sync(() => { evaluated = true; })).pipe(Effect.provideService(WorkspaceContext, stale), Effect.result);
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'FileChangedSinceRead');
      assert.equal(evaluated, false);
      const fresh = yield* workspace.open(root, { access: 'read', cache: 'off' });
      const config = yield* sources.snapshot(sources.read('concord.config.ts')).pipe(Effect.provideService(WorkspaceContext, fresh));
      assert.equal(config, fresh.configuration.source);
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources isolates concurrent operations on the same workspace and keeps a sibling alive after cancellation', async () => {
  const root = createConsumer();
  writeFileSync(join(root, 'docs/README.md'), '# Independent\n');
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const context = yield* workspace.open(root, { access: 'read', cache: 'off' });
      const snapshot = <A, E, R>(operation: Effect.Effect<A, E, R>) => sources.snapshot(operation).pipe(Effect.provideService(WorkspaceContext, context));
      const firstStarted = yield* Deferred.make<SourceSnapshot['Service']>();
      const secondStarted = yield* Deferred.make<SourceSnapshot['Service']>();
      const continueSecond = yield* Deferred.make<void>();
      const first = yield* snapshot(Effect.gen(function*() {
        yield* Deferred.succeed(firstStarted, yield* SourceSnapshot);
        yield* Effect.never;
      })).pipe(Effect.forkScoped);
      const firstIdentity = yield* Deferred.await(firstStarted);
      const second = yield* snapshot(Effect.gen(function*() {
        yield* Deferred.succeed(secondStarted, yield* SourceSnapshot);
        yield* sources.read('docs/README.md');
        yield* Deferred.await(continueSecond);
        return yield* sources.read('docs/README.md');
      })).pipe(Effect.forkScoped);
      assert.notEqual(yield* Deferred.await(secondStarted), firstIdentity);
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(continueSecond, undefined);
      assert.equal(yield* Fiber.join(second), '# Independent\n');
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources verifies inspected identities and absent paths before returning', async () => {
  const root = createConsumer();
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const sources = yield* Sources;
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'off' });
      const snapshot = <A, E, R>(operation: Effect.Effect<A, E, R>) => sources.snapshot(operation).pipe(Effect.provideService(WorkspaceContext, context));
      const metadata = yield* snapshot(Effect.gen(function*() {
        const info = yield* sources.inspect('docs/README.md');
        assert.equal(info?.file, true);
        assert.equal(Object.isFrozen(info), true);
        chmodSync(join(root, 'docs/README.md'), (info!.mode & 0o777) ^ 0o100);
      })).pipe(Effect.result);
      assert.equal(metadata._tag, 'Failure');
      if (metadata._tag === 'Failure') assert.equal(metadata.failure.code, 'SourceChanged');
      const absence = yield* snapshot(Effect.gen(function*() {
        assert.equal(yield* sources.exists('docs/new.md'), false);
        writeFileSync(join(root, 'docs/new.md'), '# New\n');
      })).pipe(Effect.result);
      assert.equal(absence._tag, 'Failure');
      if (absence._tag === 'Failure') assert.equal(absence.failure.code, 'SourceChanged');
      assert.equal(yield* snapshot(sources.exists('docs/new.md')), true);
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources revokes interrupted observations before another snapshot can read', async () => {
  const root = createConsumer();
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources;
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'off' });
      const snapshot = <A, E, R>(operation: Effect.Effect<A, E, R>) => sources.snapshot(operation).pipe(Effect.provideService(WorkspaceContext, context));
      const started = yield* Deferred.make<SourceSnapshot['Service']>();
      const pending = yield* snapshot(Effect.gen(function*() {
        const identity = yield* SourceSnapshot;
        yield* sources.read('docs/README.md');
        yield* Deferred.succeed(started, identity);
        yield* Effect.never;
      })).pipe(Effect.forkScoped);
      const interrupted = yield* Deferred.await(started);
      yield* Fiber.interrupt(pending);
      const closed = yield* sources.read('docs/README.md').pipe(Effect.provideService(SourceSnapshot, interrupted), Effect.result);
      assert.equal(closed._tag, 'Failure');
      const next = yield* snapshot(SourceSnapshot);
      assert.notEqual(next, interrupted);
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(root, process.env))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources keeps concurrent workspace observations isolated in one process layer', async () => {
  const roots = [createConsumer(), createConsumer()];
  try {
    roots.forEach((root, index) => writeFileSync(join(root, 'docs/README.md'), `# Workspace ${index}\n`));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const both = yield* Deferred.make<void>();
      let entered = 0;
      const read = Effect.fn('test.readWorkspace')(function*(root: string) {
        const context = yield* workspace.open(root, { access: 'read', cache: 'off' });
        return yield* sources.snapshot(Effect.gen(function*() {
          const context = yield* WorkspaceContext;
          if (++entered === roots.length) yield* Deferred.succeed(both, undefined);
          yield* Deferred.await(both);
          return { root: context.root, source: yield* sources.read('docs/README.md') };
        })).pipe(Effect.provideService(WorkspaceContext, context));
      });
      const values = yield* Effect.forEach(roots, read, { concurrency: 'unbounded' });
      assert.deepEqual(values, roots.map((root, index) => ({ root, source: `# Workspace ${index}\n` })));
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(roots[0]!, process.env))));
  } finally { roots.forEach(root => rmSync(root, { recursive: true, force: true })); }
});
