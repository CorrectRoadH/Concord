import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { adapterConsumer, adapterSuccess, clearAdapterCache, corruptObservation, discoverAdapter } from '../support/adapter-cache-domain.ts';
import { runApplication } from '../support/repository.ts';

const CaseList = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) });

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name external-adapter-cache-static-relations
test('external adapter preserves static relations across cold warm corrupt and cleared caches', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => runApplication(Effect.scoped(Effect.gen(function* () {
  const consumer = yield* adapterConsumer;
  const before = yield* adapterSuccess(consumer, 'check');
  const coldCases = Schema.decodeUnknownSync(CaseList)(yield* adapterSuccess(consumer, 'test.list')).cases;
  yield* discoverAdapter(consumer);
  const after = yield* adapterSuccess(consumer, 'check');
  for (const field of ['ok', 'complete', 'findings', 'cases']) assert.deepEqual(after[field], before[field]);
  for (const state of ['warm', 'corrupt', 'clear']) {
    if (state === 'corrupt') yield* corruptObservation(consumer);
    if (state === 'clear') yield* clearAdapterCache(consumer);
    const checked = yield* adapterSuccess(consumer, 'check');
    for (const field of ['ok', 'complete', 'findings']) assert.deepEqual(checked[field], before[field], state);
    const listed = yield* adapterSuccess(consumer, 'test.list');
    assert.deepEqual(Schema.decodeUnknownSync(CaseList)(listed).cases, coldCases, state);
    const observations = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Unknown) }))(listed).observations;
    assert.equal(observations.length, state === 'warm' ? 1 : 0, state);
  }
}))));
