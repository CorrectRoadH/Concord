import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { adapterConsumer, adapterSuccess, discoverAdapter } from '../support/adapter-cache-domain.ts';
import { runApplication } from '../support/repository.ts';
import { text } from '../support/test-adapters-consumer-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/collect-native-tests.md
// @name external-adapter-implementation-cache-invalidation
test('external adapter implementation changes invalidate observations until rediscovery', { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => runApplication(Effect.scoped(Effect.gen(function* () {
  const consumer = yield* adapterConsumer;
  yield* discoverAdapter(consumer);
  const observationState = Schema.decodeUnknownSync(Schema.Struct({ observations: Schema.Array(Schema.Struct({ observation: Schema.Struct({ current: Schema.Boolean, inputs: Schema.String }) })) }));
  const scriptBefore = observationState(yield* adapterSuccess(consumer, 'test.list')).observations[0]!.observation;
  yield* Effect.sync(() => text(consumer, 'adapter.ts', readFileSync(join(consumer, 'adapter.ts'), 'utf8') + '\n// implementation changed\n'));
  assert.equal(observationState(yield* adapterSuccess(consumer, 'test.list')).observations[0]!.observation.current, false);
  yield* discoverAdapter(consumer);
  const scriptAfter = observationState(yield* adapterSuccess(consumer, 'test.list')).observations[0]!.observation;
  assert.equal(scriptAfter.current, true); assert.notEqual(scriptBefore.inputs, scriptAfter.inputs);
}))));
