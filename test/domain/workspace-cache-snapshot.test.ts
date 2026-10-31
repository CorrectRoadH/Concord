import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Layer } from 'effect';
import { Cache, CacheSnapshot, PersistentCache } from '../../src/base/cache/index.js';
import { Workspace } from '../../src/base/workspace/index.js';
import { NodeServices } from '@effect/platform-node';
import { createConsumer } from '../support/consumer.js';
import { rmSync } from 'node:fs';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
test('an unavailable owner snapshot reports persistent data unavailable while rebuilding parser rows in memory', async () => {
  const root = createConsumer();
  const snapshot = { feedback_cache: [], unavailable: { code: 'HawdbUnavailable' as const, message: 'owner cannot open the persistent database' } };
  const live = Layer.merge(Workspace.layer, CacheSnapshot.layer(snapshot).pipe(Layer.provideMerge(Cache.layer))).pipe(Layer.provide(NodeServices.layer));
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(root, { access: 'read' });
      const cache = PersistentCache.repository(repo);
      assert.throws(() => cache.scan('feedback_cache'), { code: 'HawdbUnavailable' });
      assert.throws(() => cache.get('query_cache', ['trace-history']), { code: 'HawdbUnavailable' });
      cache.put('annotation_cache', [{ key: 'parser', payload: 'rebuilt' }]);
      assert.deepEqual(cache.get('annotation_cache', ['parser']), [{ key: 'parser', payload: 'rebuilt' }]);
    })).pipe(Effect.provide(live)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
