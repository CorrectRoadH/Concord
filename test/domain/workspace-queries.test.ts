import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import test from 'node:test';
import { Effect, Layer } from 'effect';
import { executeQuery, type QueryRequest } from '../../src/app/index.js';
import { CacheSnapshot } from '../../src/base/cache/index.js';
import { computationLayer } from '../../src/entry/server/index.js';
import { createConsumer } from '../support/consumer.js';
import { createDocument } from '../support/operations.js';
import { LocalRepository, runApplication } from '../support/repository.js';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('current query operations on read-only computation capabilities match cache-disabled source results', async t => {
  const root = createConsumer();
  const repository = new LocalRepository(root);
  try { createDocument(repository, 'feature', { id: 'service-query', title: 'Service query' }); }
  finally { repository.close(); }
  const requests: readonly QueryRequest[] = [
    { name: 'documents.list', input: { kind: 'feature', open: false } },
    { name: 'documents.show', input: { id: 'service-query' } },
    { name: 'config.show', input: {} }, { name: 'constitution.show', input: {} },
    { name: 'test.list', input: {} }, { name: 'code.list', input: {} },
    { name: 'trace.check', input: {} }, { name: 'check', input: {} },
    { name: 'docs.check', input: {} }, { name: 'memory.index', input: {} },
    { name: 'memory.recall', input: { query: 'query' } }, { name: 'issue.recall', input: { query: 'query' } },
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
