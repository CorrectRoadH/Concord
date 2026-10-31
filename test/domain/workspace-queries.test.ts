import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Layer, Schema } from 'effect';
import { executeQuery, type QueryRequest } from '../../src/app/index.js';
import { CacheSnapshot, CacheDerivations, PersistentCache } from '../../src/base/cache/index.js';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.js';
import { computationLayer } from '../../src/entry/server/main.js';
import { createConsumer } from '../support/consumer.js';
import { createDocument } from '../support/operations.js';
import { LocalRepository, runApplication } from '../support/repository.js';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('fresh computation requests retain the annotation parser cache owned by the long-lived process', async () => {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'local-sdlc', title: 'Local SDLC' }); }
  finally { repo.close(); }
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/case.test.ts'), '// @feature docs/feature/local-sdlc/README.md\nexport {};\n');
  const status = Schema.Struct({ value: Schema.Struct({ cache: Schema.Struct({ status: Schema.String }) }) });
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(computationLayer);
      const owner = yield* PersistentCache.owner(genericPrivateDirectorySync(root));
      yield* owner.open;
      const query = () => Effect.gen(function*() {
        const snapshot = yield* owner.snapshot, derived = CacheDerivations.make();
        const reply = yield* Effect.promise(() => Effect.runPromise(Effect.scoped(executeQuery(root, { name: 'test.list', input: {} }).pipe(Effect.provide(CacheSnapshot.layer(snapshot)), Effect.provideService(CacheDerivations, derived), Effect.provideContext(context)))));
        yield* owner.mergeDerived(derived.batches());
        return reply;
      });
      yield* query(); const second = yield* query();
      assert.equal(Schema.decodeUnknownSync(status)(second).value.cache.status, 'hit', JSON.stringify(second));
    })).pipe(Effect.provide(PersistentCache.layer)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('current query operations on read-only computation capabilities match cache-disabled source results', async t => {
  const root = createConsumer();
  const repository = new LocalRepository(root);
  try { createDocument(repository, 'feature', { id: 'service-query', title: 'Service query' }); }
  finally { repository.close(); }
  const requests: readonly QueryRequest[] = [
    { name: 'documents.list', input: { kind: 'feature' } },
    { name: 'documents.show', input: { id: 'service-query' } },
    { name: 'config.show', input: {} }, { name: 'taste', input: {} },
    { name: 'test.list', input: {} }, { name: 'code.list', input: {} },
    { name: 'trace.check', input: {} }, { name: 'check', input: {} },
    { name: 'docs.check', input: {} }, { name: 'memory.index', input: {} },
    { name: 'memory.search', input: { query: 'query' } }, { name: 'issue.search', input: { query: 'query' } },
    { name: 'feedback.list', input: { filter: { provider: 'local' } } },
    { name: 'feedback.connection.list', input: {} },
  ];
  const comparable = (value: unknown) => JSON.parse(JSON.stringify(value), (key, item) => key === 'cache' || key === 'codeCache' ? undefined : item);
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const context = yield* Layer.build(computationLayer);
      for (const request of requests) {
        yield* Effect.promise(() => t.test(request.name, async () => {
          const expected = await runApplication(executeQuery(root, request, 'off'));
          const actual = await Effect.runPromise(Effect.scoped(executeQuery(root, request).pipe(Effect.provide(CacheSnapshot.layer()), Effect.provideContext(context))));
          assert.deepEqual(comparable(actual), comparable(expected));
        }));
      }
    })));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
