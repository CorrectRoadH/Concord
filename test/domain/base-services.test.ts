import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import type * as WorkspaceTypes from '../../src/base/workspace/index.ts';
import type * as CacheTypes from '../../src/base/cache/index.ts';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Context, Deferred, Effect, Fiber, Layer, Option } from 'effect';
import { ChildProcessSpawner } from 'effect/unstable/process';
import { hasConfirmedOwnedGroupCleanup, makeOwnedProcessService } from '../../src/base/process/index.ts';
import { TestClock } from 'effect/testing';
import { Workspace } from '../../src/base/workspace/index.ts';
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
  const root = createConsumer();
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
  const root = createConsumer();
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
  const root = createConsumer();
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
  const root = createConsumer();
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
  const live = Layer.merge(Cache.layer, CacheSnapshot.layer({ document_parse: rows }));
  rows[0]!.payload = 'after';
  let closed: CacheTypes.HawdbDatabase | undefined;
  await Effect.runPromise(Effect.gen(function*() {
    const cache = yield* Cache;
    const snapshot = yield* CacheSnapshot;
    assert.deepEqual(snapshot.entries('document_parse'), [{ key: 'a', payload: 'before' }]);
    const database = yield* cache.memory;
    closed = database;
    assert.deepEqual(database.get('document_parse', ['missing']), []);
    database.put('document_parse', [{ key: 'first', payload: 'one' }]);
    database.put('document_parse', [{ key: 'second', payload: 'two' }]);
    assert.deepEqual([...database.get('document_parse', ['second', 'first', 'missing'])].sort((a, b) => a.key.localeCompare(b.key)), [{ key: 'first', payload: 'one' }, { key: 'second', payload: 'two' }]);
    database.clearNamespace('document_parse');
    database.put('document_parse', [{ key: 'first', payload: 'new' }]);
    assert.deepEqual(database.get('document_parse', ['first']), [{ key: 'first', payload: 'new' }]);
  }).pipe(Effect.scoped, Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  assert.throws(() => closed!.get('document_parse', ['missing']), cause => cause instanceof HawdbFailure && cause.code === 'HawdbClosed');
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('publication contention expires at its deadline under TestClock and releases acquired ownership', async () => {
  const root = createConsumer();
  const held = acquireTraceLeaseSync(root, 'exclusive', 'test-owner')!;
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
  const reacquired = acquireTraceLeaseSync(root, 'exclusive', 'test-after-scope')!;
  releaseTraceLeaseSync(reacquired, 'test-after-scope');
  rmSync(root, { recursive: true, force: true });
});
