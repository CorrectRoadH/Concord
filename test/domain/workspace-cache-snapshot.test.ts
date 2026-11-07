import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Layer } from 'effect';
import { Cache, CacheSnapshot, CacheDerivations, PersistentCache } from '../../src/base/cache/index.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { NodeServices } from '@effect/platform-node';
import { createConsumer } from '../support/consumer.ts';
import { rmSync } from 'node:fs';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @feature docs/feature/local-data-engine/README.md
test('an unavailable owner snapshot reports persistent data unavailable while collecting detached derivations', async () => {
  const root = (await createConsumer());
  const snapshot = { feedback_cache: [], unavailable: { code: 'HawdbUnavailable' as const, message: 'owner cannot open the persistent database' } };
  const live = Layer.merge(Workspace.layer, CacheSnapshot.layer(snapshot).pipe(Layer.provideMerge(Cache.layer))).pipe(Layer.provide(NodeServices.layer));
  const derived = CacheDerivations.make();
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(root, { access: 'read' });
      const observation = yield* CacheSnapshot;
      const entries = observation.entries('feedback_cache');
      const selected = observation.get('query_cache', ['trace-history']);
      for (const read of [entries, selected]) {
        const result = yield* Effect.result(read);
        assert.equal(result._tag, 'Failure');
        if (result._tag === 'Failure') {
          assert.equal(result.failure.code, 'HawdbUnavailable');
          assert.equal(result.failure.message, snapshot.unavailable.message);
        }
      }
      const cache = PersistentCache.repository(repo);
      assert.throws(() => cache.scan('feedback_cache'), { code: 'HawdbUnavailable' });
      assert.throws(() => cache.get('query_cache', ['trace-history']), { code: 'HawdbUnavailable' });
      cache.put('annotation_cache', [{ key: 'parser', payload: 'rebuilt' }]);
      assert.deepEqual(yield* derived.batches, [{ namespace: 'annotation_cache', entries: [{ key: 'parser', payload: 'rebuilt' }] }]);
      assert.throws(() => cache.get('annotation_cache', ['parser']), { code: 'HawdbUnavailable' });
    })).pipe(Effect.provideService(CacheDerivations, derived), Effect.provide(live)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
