import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Layer, Schema } from 'effect';
import { Cache, CacheDerivations, CacheSnapshot, ContentCache, ContentCacheOwner, HawdbFailure, OperationCache, PersistentCache, openHawdb, readWritingFindings, withOperationCache, writeWritingFindings, type ReadonlyCacheSnapshot } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { LocalRepository, Workspace, type WorkspaceMetadata } from '../../src/base/workspace/index.ts';
import { canonical, digest, objectDigest, type Repository, type WritingFinding } from '../../src/model/index.ts';
import { createConsumer } from '../support/consumer.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const parser = 'fail-fast/v1';
const input = { path: 'source.md', source: 'source' };
const partition = JSON.stringify(['document_parse', parser, undefined]);
const contentKey = objectDigest({ parser, path: input.path, sourceDigest: digest(input.source) });
const envelope = { parser, sourceDigest: digest(input.source), present: true, value: 'cached' };

for (const asynchronous of [false, true]) {
  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
  test(`content cache ${asynchronous ? 'async' : 'sync'} rejects damaged hits before parsing and preserves the row`, async () => {
    const owner = new ContentCacheOwner();
    const bound = owner.bind(runtime);
    const cache = new ContentCache('document_parse', parser, Schema.String, undefined, bound);
    const database = owner.database(bound, bound.cwd, partition)!;
    let parses = 0;
    const parse = () => { parses++; return 'recomputed'; };
    const corrupt = ['{', JSON.stringify({ ...envelope, parser: 'wrong' }), JSON.stringify({ ...envelope, sourceDigest: digest('wrong') }), JSON.stringify({ ...envelope, value: 42 }), JSON.stringify({ ...envelope, present: false }), JSON.stringify({ ...envelope, extra: true })];
    try {
      for (const payload of corrupt) {
        database.put('document_parse', [{ key: contentKey, payload }]);
        if (asynchronous) await assert.rejects(cache.getAsync(input.path, input.source, parse), { code: 'InvalidData' });
        else assert.throws(() => cache.get(input.path, input.source, parse), { code: 'InvalidData' });
        assert.equal(parses, 0);
        assert.equal(database.get('document_parse', [contentKey])[0]?.payload, payload);
      }
    } finally { cache.close(); owner.close(); }
  });

  // @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
  test(`content cache ${asynchronous ? 'async' : 'sync'} propagates native read and write failures`, async () => {
    const owner = new ContentCacheOwner();
    const bound = owner.bind(runtime);
    const cache = new ContentCache('document_parse', parser, Schema.String, undefined, bound);
    const database = owner.database(bound, bound.cwd, partition)!;
    const fault = new HawdbFailure('HawdbLimit', 'native boundary rejected this request');
    let parses = 0;
    const parse = () => { parses++; return 'parsed'; };
    try {
      for (const method of ['get', 'put'] as const) {
        const probe = mock.method(database, method, () => { throw fault; });
        try {
          if (asynchronous) await assert.rejects(cache.getAsync(input.path, input.source, parse), cause => cause === fault);
          else assert.throws(() => cache.get(input.path, input.source, parse), cause => cause === fault);
          assert.equal(parses, method === 'get' ? 0 : 1);
          assert.deepEqual(database.scan('document_parse'), []);
        } finally { probe.mock.restore(); }
      }
    } finally { cache.close(); owner.close(); }
  });
}

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('selected content memory initialization fails while explicit native=false remains a parser mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-cache-native-missing-'));
  const selected = makeRuntimeEnvironment(root, { ...runtime.env, XDG_CACHE_HOME: root });
  const cache = new ContentCache('document_parse', parser, Schema.String, undefined, selected);
  const disabled = new ContentCacheOwner(false);
  const uncached = new ContentCache('document_parse', parser, Schema.String, undefined, disabled.bind(selected));
  let parses = 0;
  const parse = () => { parses++; return 'parsed'; };
  try {
    assert.throws(() => cache.get(input.path, input.source, parse), { code: 'HawdbUnavailable' });
    await assert.rejects(cache.getAsync(input.path, input.source, parse), { code: 'HawdbUnavailable' });
    assert.equal(parses, 0);
    assert.equal(uncached.get(input.path, input.source, parse), 'parsed');
    assert.equal(await uncached.getAsync(input.path, input.source, parse), 'parsed');
    assert.equal(parses, 2);
    disabled.close();
    assert.throws(() => uncached.get(input.path, input.source, parse), { code: 'HawdbClosed' });
  } finally { cache.close(); uncached.close(); disabled.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
test('async parsing preserves per-file diagnostics, accept=false derivation and source invalidation', async () => {
  const cache = new ContentCache('document_parse', parser, Schema.String, undefined, runtime);
  const fault = new Error('one parser failed');
  let parses = 0;
  const parse = async ({ source }: { source: string }, previous?: string) => { parses++; await Promise.resolve(); if (source === 'broken') throw fault; return previous === undefined ? source : `${previous}:expanded`; };
  const inputs = [input, { path: 'bad.md', source: 'broken' }];
  try {
    const cold = await cache.getManyResultsAsync(inputs, parse);
    assert.deepEqual(cold, [{ ok: true, value: 'source' }, { ok: false, cause: fault }]);
    assert.deepEqual(await cache.getManyResultsAsync(inputs, parse), cold);
    assert.equal(parses, 3);
    assert.equal(await cache.getAsync(input.path, input.source, previous => parse(input, previous), false, () => false), 'source:expanded');
    assert.equal(await cache.getAsync(input.path, 'changed', () => 'changed'), 'changed');
  } finally { cache.close(); }
});

const snapshotLive = (snapshot: ReadonlyCacheSnapshot) => Layer.merge(Workspace.layer, CacheSnapshot.layer(snapshot)).pipe(Layer.provide(NodeServices.layer));
const withSnapshot = async (snapshot: ReadonlyCacheSnapshot, use: (repo: Repository, derived: CacheDerivations['Service']) => void) => {
  const root = await createConsumer();
  const derived = CacheDerivations.make();
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(root, { access: 'read' });
      use(repo, derived);
    })).pipe(Effect.provideService(CacheDerivations, derived), Effect.provide(snapshotLive(snapshot)), Effect.provideService(RuntimeEnvironment, runtime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
};
const inputDigest = digest('writing source');
const writingKey = `writing:${objectDigest({ format: 'concord.writing-findings/v1', inputDigest })}`;
const findings: WritingFinding[] = [{ file: 'docs/example.md', line: 1, rule: 'Example', message: 'finding', context: 'source' }];
const writingRecord = { format: 'concord.writing-findings/v1', inputDigest, findingsDigest: objectDigest(findings), findings };

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('writing cache rejects damaged JSON, schema, input identity and findings digests', async () => {
  for (const payload of ['{', JSON.stringify({ ...writingRecord, findings: [{}] }), JSON.stringify({ ...writingRecord, inputDigest: digest('other') }), JSON.stringify({ ...writingRecord, findingsDigest: digest('other') })]) {
    await withSnapshot({ query_cache: [{ key: writingKey, payload }] }, repo => {
      assert.throws(() => readWritingFindings(repo, inputDigest), { code: 'InvalidData' });
      assert.equal(PersistentCache.repository(repo).get('query_cache', [writingKey])[0]?.payload, payload);
    });
  }
});

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('writing cache rejects unavailable reads and writes and reports both findings limits', async () => {
  const unavailable = { code: 'HawdbBusy', message: 'owner holds the cache' } as const;
  await withSnapshot({ unavailable }, (repo, derived) => {
    assert.throws(() => readWritingFindings(repo, inputDigest), unavailable);
    assert.throws(() => writeWritingFindings(repo, inputDigest, findings), unavailable);
    assert.deepEqual(Effect.runSync(derived.batches), []);
  });
  await withSnapshot({}, (repo, derived) => {
    assert.equal(readWritingFindings(repo, inputDigest), undefined);
    assert.throws(() => writeWritingFindings(repo, inputDigest, Array.from({ length: 10001 }, () => findings[0]!)), { code: 'HawdbLimit' });
    assert.throws(() => writeWritingFindings(repo, inputDigest, [{ ...findings[0]!, context: '界'.repeat(3 * 1024 * 1024) }]), { code: 'HawdbLimit' });
    assert.deepEqual(Effect.runSync(derived.batches), []);
    writeWritingFindings(repo, inputDigest, findings);
    assert.equal(Effect.runSync(derived.batches)[0]?.entries[0]?.payload, canonical(writingRecord));
  });
});

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('persistent attach propagates selected memory initialization failure', async () => {
  const root = await createConsumer();
  const missing = mkdtempSync(join(tmpdir(), 'concord-attach-native-missing-'));
  const repo = await LocalRepository.open(root, { access: 'read', persistentCache: 'off', runtime });
  try {
    const selected = makeRuntimeEnvironment(root, { ...runtime.env, XDG_CACHE_HOME: missing });
    const live = PersistentCache.layer.pipe(Layer.provideMerge(Cache.layer));
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      return yield* Effect.result((yield* PersistentCache).attach(repo));
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, selected)));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') assert.equal(result.failure.code, 'HawdbUnavailable');
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); rmSync(missing, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('repository and operation caches propagate real contention while cache-off never touches persistent data', async () => {
  const root = await createConsumer();
  const privateDir = join(root, '.git/concord');
  const held = openHawdb(join(privateDir, 'cache.hawdb'), { create: true, readOnly: false }, runtime);
  try {
    held.put('config_cache', [{ key: 'retained', payload: 'retained' }]);
    const live = Layer.merge(Workspace.layer, PersistentCache.layer.pipe(Layer.provideMerge(Cache.layer))).pipe(Layer.provide(NodeServices.layer));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const repo = yield* workspace.openRead(root, { access: 'read' });
      const cache = PersistentCache.repository(repo);
      assert.throws(() => cache.prepareWrite(), { code: 'HawdbBusy' });
      assert.throws(() => cache.get('document_parse', ['anything']), { code: 'HawdbBusy' });
      const context = yield* workspace.open(root, { access: 'read', cache: 'use' });
      yield* withOperationCache(context, runtime, Effect.gen(function*() {
        const operation = yield* OperationCache;
        let updates = 0;
        assert.throws(() => operation.read('config_cache'), { code: 'HawdbBusy' });
        assert.throws(() => operation.update('config_cache', 'new', () => { updates++; return 'new'; }), { code: 'HawdbBusy' });
        assert.equal(updates, 0);
      }));
      const off: WorkspaceMetadata = { ...context, cache: 'off' };
      yield* withOperationCache(off, runtime, Effect.gen(function*() {
        const operation = yield* OperationCache;
        assert.deepEqual(operation.read('config_cache'), []);
        assert.throws(() => operation.update('config_cache', 'new', () => 'new'), { code: 'HawdbUnavailable' });
      }));
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
    assert.deepEqual(held.get('config_cache', ['new']), []);
    assert.equal(held.get('config_cache', ['retained'])[0]?.payload, 'retained');
  } finally { held.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md#rebuild
test('a cold persistent cache is absent on read and created by the first derived write', async () => {
  const root = await createConsumer();
  const path = join(root, '.git/concord/cache.hawdb');
  const live = Layer.merge(Workspace.layer, PersistentCache.layer.pipe(Layer.provideMerge(Cache.layer))).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(root, { access: 'read' });
      const cache = PersistentCache.repository(repo);
      assert.deepEqual(cache.get('query_cache', ['cold']), []);
      assert.equal(existsSync(path), false);
      cache.put('query_cache', [{ key: 'cold', payload: 'derived' }]);
      assert.equal(existsSync(path), true);
      assert.deepEqual(cache.get('query_cache', ['cold']), [{ key: 'cold', payload: 'derived' }]);
    })).pipe(Effect.provide(live), Effect.provideService(RuntimeEnvironment, runtime)));
    const reopened = openHawdb(path, { readOnly: true, create: false }, runtime);
    try { assert.equal(reopened.get('query_cache', ['cold'])[0]?.payload, 'derived'); }
    finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
