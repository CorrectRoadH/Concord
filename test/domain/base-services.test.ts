import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import type * as WorkspaceTypes from '../../src/base/workspace/index.ts';
import type * as CacheTypes from '../../src/base/cache/index.ts';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Context, Deferred, Effect, Fiber, Layer, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/process';
import { hasConfirmedOwnedGroupCleanup, makeOwnedProcessService } from '../../src/base/process/index.ts';
import { TestClock } from 'effect/testing';
import { Workspace, WorkspaceContext } from '../../src/base/workspace/index.ts';
import { renderTypeScriptConfig } from '../../src/base/workspace/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { Cache, CacheSnapshot, HawdbFailure, cacheDatabasePath, openHawdb } from '../../src/base/cache/index.ts';
import { waitForPublication, acquireTraceLeaseSync, releaseTraceLeaseSync, Publication } from '../../src/base/publication/index.ts';
import { publicationLayer } from '../support/repository.ts';
import { cliLayer } from '../../src/entry/cli/index.ts';
import { readerLayer, writerLayer, refreshLayer } from '../../src/entry/server/main.ts';
import { operationLayer } from '../../src/entry/server/operation/main.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { Git } from '../../src/base/git/index.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/local-sdlc/README.md
test('OwnedProcess preserves cancellation received while the platform is acquiring a real child', async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
    const spawned = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    // Only the external platform boundary is delayed; spawning and cleanup are real.
    const owner = makeOwnedProcessService({ environment: nativeRuntime, spawner: { ...platform, spawn: command => platform.spawn(command).pipe(
      Effect.tap(() => Deferred.succeed(spawned, undefined)), Effect.tap(() => Deferred.await(proceed)),
    ) } });
    const fiber = yield* Effect.forkChild(Effect.scoped(owner.run([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { cwd: process.cwd(), timeoutMs: 3000 })));
    yield* Deferred.await(spawned);
    yield* owner.requestStop('SIGTERM');
    yield* Deferred.succeed(proceed, undefined);
    const result = yield* Fiber.join(fiber);
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
    assert.equal(hasConfirmedOwnedGroupCleanup(result), true);
    assert.equal(yield* owner.activeCount, 0);
  })).pipe(Effect.provide(NodeServices.layer)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
});

// @feature docs/feature/project-onboarding/README.md
test('Workspace rereads configuration for each operation and Sources rejects a changed snapshot', async () => {
  const root = (await createConsumer());
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig({}));
  const live = Layer.merge(Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const sources = yield* Sources;
      const first = yield* workspace.openRead(root, { access: 'read', persistentCache: 'off' });
      const before = first.configSnapshot.source;
      writeFileSync(join(root, 'concord.config.ts'), `${before}\n`);
      const second = yield* workspace.openRead(root, { access: 'read', persistentCache: 'off' });
      assert.equal(second.configSnapshot.source, `${before}\n`);
      const result = yield* Effect.result(sources.snapshot(second, Effect.sync(() => {
        second.read('docs/README.md');
        writeFileSync(join(root, 'docs/README.md'), '# Changed\n');
      })));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'SourceChanged');
    }).pipe(Effect.scoped, Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('read snapshots reread current inputs, verify original observations and discard captures before the next operation', async () => {
  const root = (await createConsumer());
  const live = Layer.merge(Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(root, { access: 'read', persistentCache: 'off' });
      const sources = yield* Sources;
      const result = yield* Effect.result(sources.snapshot(repo, Effect.sync(() => {
        assert.notEqual(repo.read('docs/README.md'), '# Updated\n');
        const paths = repo.files('docs');
        const expected = [...paths]; paths.length = 0;
        assert.deepEqual(repo.files('docs'), expected);
        writeFileSync(join(root, 'docs/README.md'), '# Updated\n');
        assert.equal(repo.read('docs/README.md'), '# Updated\n');
      })));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'SourceChanged');
      yield* sources.snapshot(repo, Effect.sync(() => assert.equal(repo.read('docs/README.md'), '# Updated\n')));
    })).pipe(Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('entry layers build the declared reader and operation capabilities', async () => {
  for (const [name, layer, writes, persistent, git] of [
    ['CLI', cliLayer, true, true, true],
    ['HTTP operation process', operationLayer(), true, false, true],
    ['reader worker', readerLayer, false, false, false],
    ['cache maintenance worker', writerLayer, true, true, false],
  ] as const) {
    const context = await Effect.runPromise(Effect.scoped(Layer.build(layer)).pipe(Effect.provide(NodeServices.layer), Effect.provideService(RuntimeEnvironment, nativeRuntime)));
    assert.equal(Option.isSome(Context.getOption(context, Workspace)), true, name);
    assert.equal(Option.isSome(Context.getOption(context, Sources)), true, name);
    assert.equal(Option.isSome(Context.getOption(context, Cache)), true, name);
    assert.equal(Option.isSome(Context.getOption(context, CacheSnapshot)), true, name);
    assert.equal(Option.isSome(Context.getOption(context, Publication)), writes, name);
    assert.equal(Option.isSome(Context.getOption(context, Git)), git, name);
    assert.equal(Option.isSome(Context.getOption(context, PersistentCache)), persistent, name);
  }
  const refresh = await Effect.runPromise(Effect.scoped(Layer.build(refreshLayer)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  assert.equal(Option.isSome(Context.getOption(refresh, Workspace)), true);
  assert.equal(Option.isSome(Context.getOption(refresh, Publication)), false);
  assert.equal(Option.isSome(Context.getOption(refresh, PersistentCache)), true);
});

// @feature docs/feature/local-data-engine/README.md
test('PersistentCache reuses nested source ownership and releases the native handle at the outer boundary', async () => {
  const root = (await createConsumer());
  const live = Layer.mergeAll(Workspace.layer, Sources.layer, PersistentCache.layer).pipe(Layer.provide(NodeServices.layer));
  let captured: WorkspaceTypes.LocalRepository | undefined;
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace, sources = yield* Sources;
      const repo = yield* workspace.openRead(root, { access: 'read' }); captured = repo;
      yield* sources.snapshot(repo, Effect.sync(() => {
        PersistentCache.repository(repo).prepareWrite({ create: true });
        PersistentCache.repository(repo).put('code_cache', [{ key: 'scope-test', payload: 'value' }]);
        repo.snapshot(() => assert.deepEqual(PersistentCache.repository(repo).get('code_cache', ['scope-test']), [{ key: 'scope-test', payload: 'value' }]));
        assert.throws(() => openHawdb(cacheDatabasePath(repo.privateDir), { readOnly: true, create: false }, nativeRuntime), { code: 'HawdbBusy' });
      }));
      const database = openHawdb(cacheDatabasePath(repo.privateDir), { readOnly: true, create: false }, nativeRuntime);
      try { assert.deepEqual(database.get('code_cache', ['scope-test']), [{ key: 'scope-test', payload: 'value' }]); }
      finally { database.close(); }
    })).pipe(Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
    assert.deepEqual(PersistentCache.repository(captured!).get('code_cache', ['scope-test']), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('Sources snapshots verify raw bytes and isolate caller mutations', async () => {
  const root = (await createConsumer());
  const path = 'binary-input.bin';
  writeFileSync(join(root, path), Buffer.from([0xff, 0, 0x80]));
  const live = Layer.merge(Workspace.layer, Sources.layer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace, sources = yield* Sources;
      const repo = yield* workspace.openRead(root, { access: 'read', persistentCache: 'off' });
      yield* sources.snapshot(repo, Effect.sync(() => { repo.readBytes(path)![0] = 0; }));
      const result = yield* Effect.result(sources.snapshot(repo, Effect.sync(() => {
        assert.deepEqual([...repo.readBytes(path)!], [0xff, 0, 0x80]);
        writeFileSync(join(root, path), Buffer.from([0xfe, 0, 0x80]));
      })));
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'SourceChanged');
    })).pipe(Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('memory Cache owns its handle and read-only snapshots retain detached immutable rows', async () => {
  const rows = [{ key: 'a', payload: 'before' }];
  const root = (await createConsumer());
  const live = Layer.mergeAll(Workspace.layer, Cache.layer, CacheSnapshot.layer({ document_parse: rows })).pipe(Layer.provide(NodeServices.layer));
  rows[0]!.payload = 'after';
  let closed: CacheTypes.CacheService | undefined;
  let metadata: WorkspaceTypes.WorkspaceMetadata | undefined;
  try {
    await Effect.runPromise(Effect.gen(function*() {
      metadata = yield* (yield* Workspace).open(root, { access: 'read', cache: 'use' });
      const cache = yield* Cache;
      const snapshot = yield* CacheSnapshot;
      assert.deepEqual(yield* snapshot.entries('document_parse'), [{ key: 'a', payload: 'before' }]);
      assert.deepEqual(yield* snapshot.get('document_parse', ['missing', 'a']), [{ key: 'a', payload: 'before' }]);
      closed = cache;
      yield* Effect.gen(function*() {
        assert.deepEqual(yield* cache.get('document_parse', ['missing']), []);
        yield* cache.put('document_parse', [{ key: 'first', payload: 'one' }]);
        yield* cache.put('document_parse', [{ key: 'second', payload: 'two' }]);
        assert.deepEqual([...(yield* cache.get('document_parse', ['second', 'first', 'missing']))].sort((a, b) => a.key.localeCompare(b.key)), [{ key: 'first', payload: 'one' }, { key: 'second', payload: 'two' }]);
        yield* cache.put('document_parse', [{ key: 'first', payload: 'new' }]);
        assert.deepEqual(yield* cache.get('document_parse', ['first']), [{ key: 'first', payload: 'new' }]);
      }).pipe(Effect.provideService(WorkspaceContext, metadata));
    }).pipe(Effect.scoped, Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
    const result = await Effect.runPromise(Effect.result(closed!.get('document_parse', ['missing'])).pipe(Effect.provideService(WorkspaceContext, metadata!)));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.equal(result.failure.code, 'HawdbClosed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('memory cache separates workspace contexts and survives individual source snapshots', async () => {
  const roots = [(await createConsumer()), (await createConsumer())];
  const live = Layer.mergeAll(Workspace.layer, Sources.layer, Cache.layer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const workspace = yield* Workspace, sources = yield* Sources, cache = yield* Cache;
      const first = yield* workspace.open(roots[0]!, { access: 'read', cache: 'use' });
      const second = yield* workspace.open(roots[1]!, { access: 'read', cache: 'use' });
      yield* sources.snapshot(cache.put('document_parse', [{ key: 'same', payload: 'first' }])).pipe(Effect.provideService(WorkspaceContext, first));
      yield* sources.snapshot(Effect.gen(function*() {
        assert.deepEqual(yield* cache.get('document_parse', ['same']), []);
        yield* cache.put('document_parse', [{ key: 'same', payload: 'second' }]);
      })).pipe(Effect.provideService(WorkspaceContext, second));
      assert.deepEqual(yield* cache.get('document_parse', ['same']).pipe(Effect.provideService(WorkspaceContext, first)), [{ key: 'same', payload: 'first' }]);
      assert.deepEqual(yield* cache.get('document_parse', ['same']).pipe(Effect.provideService(WorkspaceContext, second)), [{ key: 'same', payload: 'second' }]);
      const disabled = { ...first, cache: 'off' as const };
      yield* cache.put('document_parse', [{ key: 'same', payload: 'disabled' }]).pipe(Effect.provideService(WorkspaceContext, disabled));
      assert.deepEqual(yield* cache.get('document_parse', ['same']).pipe(Effect.provideService(WorkspaceContext, disabled)), []);
      assert.deepEqual(yield* cache.get('document_parse', ['same']).pipe(Effect.provideService(WorkspaceContext, first)), [{ key: 'same', payload: 'first' }]);
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('source snapshot cache closes before publication and cannot reopen within the lease', async () => {
  const root = (await createConsumer()), otherRoot = (await createConsumer());
  const live = Layer.mergeAll(Workspace.layer, Sources.layer, PersistentCache.layer, publicationLayer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const workspace = yield* Workspace, sources = yield* Sources, cache = yield* PersistentCache, publication = yield* Publication;
      const context = yield* workspace.open(root, { access: 'write', cache: 'use' });
      const other = yield* workspace.open(otherRoot, { access: 'read', cache: 'use' });
      const path = cacheDatabasePath(context.privateDir);
      yield* sources.snapshot(Effect.gen(function*() {
        yield* cache.update(context.privateDir, 'config_cache', 'kept', () => 'value');
        assert.throws(() => openHawdb(path, { readOnly: false, create: true }, nativeRuntime), cause => cause instanceof HawdbFailure && cause.code === 'HawdbBusy');
        yield* sources.snapshot(cache.read(context.privateDir, 'config_cache', ['kept']).pipe(Effect.tap(rows => Effect.sync(() => assert.deepEqual(rows, [{ key: 'kept', payload: 'value' }])))));
        yield* Effect.scoped(Effect.gen(function*() {
          assert.notEqual(yield* publication.lease(root, 'cache-boundary-test'), undefined);
          const independent = openHawdb(path, { readOnly: false, create: false }, nativeRuntime);
          independent.close();
          const read = yield* Effect.result(cache.read(context.privateDir, 'config_cache', ['kept']));
          assert.equal(read._tag, 'Failure');
          if (read._tag === 'Failure') assert.equal(read.failure.code, 'HawdbUnavailable');
          const write = yield* Effect.result(cache.update(context.privateDir, 'config_cache', 'kept', () => 'forbidden'));
          assert.equal(write._tag, 'Failure');
          if (write._tag === 'Failure') assert.equal(write.failure.code, 'HawdbUnavailable');
          const nested = yield* Effect.result(sources.snapshot(cache.read(other.privateDir, 'config_cache', ['kept'])).pipe(Effect.provideService(WorkspaceContext, other)));
          assert.equal(nested._tag, 'Failure');
          if (nested._tag === 'Failure') assert.equal(nested.failure.code, 'HawdbUnavailable');
        }));
        assert.deepEqual(yield* cache.read(context.privateDir, 'config_cache', ['kept']), [{ key: 'kept', payload: 'value' }]);
      })).pipe(Effect.provideService(WorkspaceContext, context));
      const independent = openHawdb(path, { readOnly: false, create: false }, nativeRuntime);
      independent.close();
    }).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { for (const directory of [root, otherRoot]) rmSync(directory, { recursive: true, force: true }); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('interrupting an operation releases its lazily opened persistent cache handle', async () => {
  const root = (await createConsumer());
  const live = Layer.mergeAll(Workspace.layer, Sources.layer, PersistentCache.layer).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const context = yield* (yield* Workspace).open(root, { access: 'read', cache: 'use' });
      const sources = yield* Sources, cache = yield* PersistentCache;
      const opened = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(sources.snapshot(Effect.gen(function*() {
        yield* cache.update(context.privateDir, 'config_cache', 'cancelled', () => 'retained');
        yield* Deferred.succeed(opened, undefined);
        yield* Effect.never;
      })).pipe(Effect.provideService(WorkspaceContext, context)));
      yield* Deferred.await(opened);
      yield* Fiber.interrupt(fiber);
      const independent = openHawdb(cacheDatabasePath(context.privateDir), { readOnly: false, create: false }, nativeRuntime);
      try { assert.deepEqual(independent.get('config_cache', ['cancelled']), [{ key: 'cancelled', payload: 'retained' }]); }
      finally { independent.close(); }
    }).pipe(Effect.scoped, Effect.provide(live), Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('publication contention expires at its deadline under TestClock and releases acquired ownership', async () => {
  const root = (await createConsumer());
  const held = acquireTraceLeaseSync(root, 'exclusive', 'test-owner', undefined, undefined, process.env)!;
  try {
    await Effect.runPromise(Effect.gen(function*() {
      const publication = yield* Publication;
      const fiber = yield* Effect.forkChild(Effect.result(Effect.scoped(waitForPublication(() => publication.lease(root, 'test-waiter')))));
      yield* TestClock.adjust(3000);
      const result = yield* Fiber.join(fiber);
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') assert.equal(result.failure.code, 'RepositoryBusy');
    }).pipe(Effect.provide(publicationLayer), Effect.provide(TestClock.layer())).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { releaseTraceLeaseSync(held, 'test-owner'); }
  await Effect.runPromise(Effect.scoped(Effect.flatMap(Publication, publication => publication.lease(root, 'test-released'))).pipe(Effect.provide(publicationLayer)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  const reacquired = acquireTraceLeaseSync(root, 'exclusive', 'test-after-scope', undefined, undefined, process.env)!;
  releaseTraceLeaseSync(reacquired, 'test-after-scope');
  rmSync(root, { recursive: true, force: true });
});
