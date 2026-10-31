import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber, SubscriptionRef } from 'effect';
import { TestClock } from 'effect/testing';
import { makeWorkspaceService } from '../../src/entry/server/service.js';
import { makeRequestAdmission } from '../../src/entry/server/request-admission.js';
import { ConcordError } from '../../src/model/index.js';
import { ports, stateLayer } from '../support/workspace-service-fixture.js';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/draining-rejects-queued-writes.md
test('draining waits for accepted operations and queues later writes until maintenance releases', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let closes = 0, queuedRuns = 0;
  const service = yield* makeWorkspaceService(ports({ close: Effect.sync(() => { closes++; }) }));
  yield* TestClock.adjust(0);
  const operation: unknown = Reflect.get(service, 'operate');
  assert.equal(typeof operation, 'function', 'operation admission must participate in the service state machine');
  const operate = operation as <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, unknown>;
  const admission = makeRequestAdmission();
  const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
  const active = yield* admission.withSlot(operate(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))).pipe(Effect.forkScoped);
  yield* Deferred.await(entered);
  const clearing = yield* service.clear.pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.equal((yield* SubscriptionRef.get(service.state.value)).state, 'draining');
  assert.equal(closes, 0, 'accepted operations finish before handles and idle workers close');
  const queued = yield* admission.withSlot(operate(Effect.sync(() => { queuedRuns++; }))).pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.equal(queuedRuns, 0);
  assert.equal(admission.pending(), 2, 'both executing and queued requests retain their global reservation');
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(active);
  yield* Fiber.join(clearing);
  yield* Fiber.join(queued);
  assert.equal(closes, 1);
  assert.equal(queuedRuns, 1);
  assert.equal(admission.pending(), 0);
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/draining-rejects-queued-writes.md
test('HTTP operation admission shares the RPC pool and releases cancelled queued reservations', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const service = yield* makeWorkspaceService(ports());
  yield* TestClock.adjust(0);
  const operation: unknown = Reflect.get(service, 'operate');
  assert.equal(typeof operation, 'function');
  const operate = operation as <A, E>(effect: Effect.Effect<A, E>) => Effect.Effect<A, unknown>;
  const admission = makeRequestAdmission();
  const reservations = Array.from({ length: 255 }, () => admission.reserve()!);
  const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
  const active = yield* admission.withSlot(operate(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))).pipe(Effect.forkScoped);
  yield* Deferred.await(entered);
  const rejected = yield* admission.withSlot(operate(Effect.void)).pipe(Effect.result);
  assert.equal(rejected._tag, 'Failure');
  if (rejected._tag === 'Failure') { assert.ok(rejected.failure instanceof ConcordError); assert.equal(rejected.failure.code, 'WorkspaceServerBusy'); }
  const clearing = yield* service.clear.pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  reservations.pop()!();
  const queued = yield* admission.withSlot(operate(Effect.void)).pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.equal(admission.pending(), 256);
  yield* Fiber.interrupt(queued);
  assert.equal(admission.pending(), 255);
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(active);
  yield* Fiber.join(clearing);
  for (const release of reservations) release();
  assert.equal(admission.pending(), 0);
})).pipe(Effect.provide(stateLayer))));
