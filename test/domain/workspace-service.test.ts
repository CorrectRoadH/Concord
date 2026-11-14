import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber, Layer, SubscriptionRef } from 'effect';
import { TestClock } from 'effect/testing';
import { WorkspaceState, waitForServerHandshake } from '../../src/entry/server/state.ts';
import { makeWorkspaceService, type RuntimePorts } from '../../src/entry/server/service.ts';
import { ConcordError, type WorkspaceProjection, type WorkspaceProjectionRecord } from '../../src/model/index.ts';
import { displaySnapshot } from '../support/workspace-display-fixture.ts';

import { record, projection, ports, stateLayer } from '../support/workspace-service-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('service expiry uses the Effect clock and a connected client prevents idle shutdown', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const service = yield* makeWorkspaceService(ports({ compute: () => Effect.never }));
  const connection = yield* Effect.forkScoped(Effect.scoped(service.connect.pipe(Effect.andThen(Effect.never))));
  yield* TestClock.adjust(600_000);
  assert.notEqual((yield* SubscriptionRef.get(service.state.value)).state, 'stopping');
  yield* Fiber.interrupt(connection);
  yield* TestClock.adjust(5000);
  yield* service.stopped;
  assert.equal((yield* SubscriptionRef.get(service.state.value)).state, 'stopping');
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
test('watch invalidations debounce on the Effect clock and persistent edits cannot postpone beyond two seconds', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let scans = 0;
  const service = yield* makeWorkspaceService(ports({ compute: () => Effect.sync(() => { scans++; return record; }) }));
  yield* TestClock.adjust(0);
  const initial = scans;
  yield* service.invalidate;
  for (let i = 0; i < 9; i++) { yield* TestClock.adjust(200); yield* service.invalidate; }
  assert.equal(scans, initial);
  yield* TestClock.adjust(200);
  assert.equal(scans, initial + 1);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
test('cache clear waits for accepted computation then closes ownership before deleting', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const started = yield* Deferred.make<void>(), finish = yield* Deferred.make<unknown>();
  const order: string[] = [];
  let first = true;
  const service = yield* makeWorkspaceService(ports({
    compute: () => first ? Effect.gen(function*() { first = false; yield* Deferred.succeed(started, undefined); return yield* Deferred.await(finish); }) : Effect.succeed(record),
    close: Effect.sync(() => { order.push('close'); }),
    clear: Effect.sync(() => { order.push('clear'); return { status: 'cleared' }; }),
    open: Effect.sync(() => { order.push('open'); }),
  }));
  yield* Deferred.await(started);
  const clear = yield* Effect.forkScoped(service.clear);
  yield* TestClock.adjust(0);
  assert.deepEqual(order, ['open']);
  yield* Deferred.succeed(finish, record);
  yield* Fiber.join(clear);
  assert.deepEqual(order.slice(0, 4), ['open', 'close', 'clear', 'open']);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
test('runtime native health failure closes persistent ownership and retries repair on the Effect clock', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let broken = false, closes = 0, opens = 0;
  const service = yield* makeWorkspaceService(ports({
    health: Effect.suspend(() => broken ? Effect.fail(new ConcordError('HawdbUnavailable', 'native artifact missing')) : Effect.void),
    context: Effect.suspend(() => broken ? Effect.fail(new ConcordError('WorkspaceProjectionUnavailable', 'installation cannot identify the projection')) : Effect.succeed({ root: '/fixture', privateDir: '/fixture/private', identity: 'fixture' })),
    open: Effect.sync(() => { if (broken) throw new Error('open must wait for repair'); opens++; }),
    close: Effect.sync(() => { closes++; }),
  }));
  yield* TestClock.adjust(0);
  assert.equal(opens, 1);
  broken = true; yield* TestClock.adjust(1000);
  assert.equal((yield* SubscriptionRef.get(service.state.value)).state, 'degraded');
  assert.equal((yield* SubscriptionRef.get(service.state.value)).error?.code, 'HawdbUnavailable');
  assert.equal(closes, 1);
  broken = false; yield* TestClock.adjust(1000);
  assert.equal((yield* SubscriptionRef.get(service.state.value)).state, 'running');
  assert.equal(opens, 2);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
test('stopping and blocked states cannot be revived by a late watcher callback', () => Effect.runPromise(Effect.gen(function*() {
  const state = yield* WorkspaceState;
  yield* state.transition('blocked', { code: 'CleanupFailed', message: 'unconfirmed' });
  yield* state.transition('running');
  assert.equal((yield* SubscriptionRef.get(state.value)).state, 'blocked');
  yield* state.transition('stopping'); yield* state.transition('running');
  assert.equal((yield* SubscriptionRef.get(state.value)).state, 'stopping');
}).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
test('service startup waits ten seconds on the Effect clock and cancels an unresponsive handshake', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const started = yield* Deferred.make<void>();
  const waiting = yield* Effect.forkScoped(Effect.result(waitForServerHandshake(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))));
  yield* Deferred.await(started);
  yield* TestClock.adjust(9999);
  assert.equal(waiting.pollUnsafe(), undefined);
  yield* TestClock.adjust(1);
  const outcome = yield* Fiber.join(waiting);
  assert.equal(outcome._tag, 'Failure');
  if (outcome._tag === 'Failure') assert.equal(outcome.failure.code, 'WorkspaceServerUnavailable');
})).pipe(Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/README.md
test('service startup returns the actual winning handshake before its Effect deadline', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const connected = yield* Deferred.make<{ token: string }>();
  const waiting = yield* Effect.forkScoped(waitForServerHandshake(Deferred.await(connected)));
  yield* TestClock.adjust(9000);
  yield* Deferred.succeed(connected, { token: 'winner' });
  assert.deepEqual(yield* Fiber.join(waiting), { token: 'winner' });
})).pipe(Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('a failed refresh rejects business work while diagnostics and explicit clear remain available', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let broken = true, businessCalls = 0;
  const service = yield* makeWorkspaceService(ports({ compute: () => broken ? Effect.fail(new ConcordError('HawdbLimit', 'cache budget')) : Effect.succeed(record) }));
  yield* TestClock.adjust(0);
  assert.equal((yield* service.current).error?.code, 'HawdbLimit');
  const result = yield* Effect.result(service.operate(Effect.sync(() => { businessCalls++; })));
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') { assert.ok(result.failure instanceof ConcordError); assert.equal(result.failure.code, 'HawdbLimit'); }
  assert.equal(businessCalls, 0);
  assert.equal(yield* service.maintain(Effect.succeed('diagnostic')), 'diagnostic');
  broken = false;
  yield* service.clear;
  yield* TestClock.adjust(0);
  yield* service.operate(Effect.sync(() => { businessCalls++; }));
  assert.equal(businessCalls, 1);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/architecture.md#failure-propagation
test('a failure before physical clear leaves a diagnosable blocked service', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let deleted = false;
  const service = yield* makeWorkspaceService(ports({ beforeClear: Effect.fail(new ConcordError('UnsafePath', 'changed directory')), clear: Effect.sync(() => { deleted = true; }) }));
  yield* TestClock.adjust(0);
  const result = yield* Effect.result(service.clear);
  assert.equal(result._tag, 'Failure');
  assert.equal(deleted, false);
  assert.equal((yield* service.current).state, 'blocked');
  assert.equal(yield* service.maintain(Effect.succeed('diagnostic')), 'diagnostic');
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));
