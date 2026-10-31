import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber, Layer, SubscriptionRef } from 'effect';
import { TestClock } from 'effect/testing';
import { WorkspaceState, waitForServerHandshake } from '../../src/entry/server/state.js';
import { makeWorkspaceService, type RuntimePorts } from '../../src/entry/server/service.js';
import { ConcordError, type WorkspaceProjection, type WorkspaceProjectionRecord } from '../../src/model/index.js';
import { panelSnapshot } from '../support/panel-fixture.js';

const record: WorkspaceProjectionRecord = { builtAt: '2026-10-30T00:00:00.000Z', builtFrom: '2026-10-30T00:00:00.000Z', builtUntil: '2026-10-30T00:00:00.000Z', complete: true, consistent: true, changedPaths: [], unknownRelations: false, snapshot: { ...panelSnapshot, cache: { status: 'ready' }, diagnostics: { operation: 'doctor', ok: true, root: '/worktree', node: 'test', configuration: {}, missingTestRoots: [], missingSourceRoots: [], codeDeclarations: 1, documents: 2, cases: 2, findings: [], nextSteps: [] } } };
const { snapshot, ...status } = record;
const projection: WorkspaceProjection = { snapshot, projection: { ...status, status: 'ready', current: false, refreshOwner: 'active' } };
const ports = (overrides: Partial<RuntimePorts> = {}): RuntimePorts => ({
  verify: Effect.void, context: Effect.succeed({ root: '/fixture', privateDir: '/fixture/private', identity: 'fixture' }),
  ready: () => Effect.void, restore: () => Effect.succeed(projection), persist: () => Effect.void,
  compute: () => Effect.succeed(record), open: Effect.void, close: Effect.void,
  clear: Effect.succeed({ status: 'cleared' }), exists: Effect.succeed(true), ...overrides,
});
const stateLayer = WorkspaceState.layer('test-instance').pipe(Layer.provideMerge(TestClock.layer()));

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/workspace-server-unimplemented.md
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
// @issue docs/issues/workspace-server-unimplemented.md
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
// @issue docs/issues/workspace-server-unimplemented.md
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
// @issue docs/issues/workspace-server-unimplemented.md
test('runtime native health failure closes persistent ownership and retries repair on the Effect clock', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let broken = false, closes = 0, opens = 0;
  const service = yield* makeWorkspaceService(ports({
    health: Effect.suspend(() => broken ? Effect.fail(new ConcordError('HawdbUnavailable', 'native artifact missing')) : Effect.void),
    open: Effect.sync(() => { if (broken) throw new Error('open must wait for repair'); opens++; }),
    close: Effect.sync(() => { closes++; }),
  }));
  yield* TestClock.adjust(0);
  assert.equal(opens, 1);
  broken = true; yield* TestClock.adjust(1000);
  assert.equal((yield* SubscriptionRef.get(service.state.value)).state, 'degraded');
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
// @issue docs/issues/workspace-server-unimplemented.md
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
