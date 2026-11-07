import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Exit, Fiber, FiberSet, Scope, Stream } from 'effect';
import { makeHttpSubscriptions } from '../../src/entry/server/subscriptions.ts';
import type { WorkspaceEvent } from '../../src/entry/server/state.ts';

const event = (state: WorkspaceEvent['state']): WorkspaceEvent => ({ token: 'instance', sourceDigest: null, state });

// @feature docs/feature/web-workbench/README.md
test('HTTP subscriptions remove naturally completed fibers and deliver stopping before releasing the connection', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const observed: string[] = [];
  const subscriptions = yield* makeHttpSubscriptions(Stream.make(event('running'), event('stopping'), event('running')),
    Effect.acquireRelease(Effect.void, () => Effect.sync(() => { observed.push('released'); })));
  subscriptions.subscribe(value => { observed.push(value.state); });
  yield* FiberSet.awaitEmpty(subscriptions.fibers);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 0);
  assert.deepEqual(observed, ['running', 'stopping', 'released']);
}))));

// @feature docs/feature/web-workbench/README.md
test('HTTP unsubscribe interrupts the subscription and awaits its connection finalizer before drain completes', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const connected = yield* Deferred.make<void>(), released = yield* Deferred.make<void>();
  const subscriptions = yield* makeHttpSubscriptions(Stream.never,
    Effect.acquireRelease(Deferred.succeed(connected, undefined), () => Deferred.succeed(released, undefined)));
  const unsubscribe = subscriptions.subscribe(() => {});
  yield* Deferred.await(connected);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 1);
  unsubscribe();
  yield* FiberSet.awaitEmpty(subscriptions.fibers);
  assert.equal(yield* Deferred.isDone(released), true);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 0);
  unsubscribe();
}))));

// @feature docs/feature/web-workbench/README.md
test('HTTP subscription owner scope interrupts all active subscriptions and rejects subscriptions after closure', () => Effect.runPromise(Effect.gen(function*() {
  const scope = yield* Scope.make();
  const connected = yield* Deferred.make<void>();
  let connections = 0, releases = 0;
  const subscriptions = yield* makeHttpSubscriptions(Stream.never,
    Effect.acquireRelease(Effect.sync(() => { connections++; }), () => Effect.sync(() => { releases++; }))
      .pipe(Effect.andThen(Effect.suspend(() => connections === 2 ? Deferred.succeed(connected, undefined) : Effect.void))))
    .pipe(Scope.provide(scope));
  subscriptions.subscribe(() => {});
  subscriptions.subscribe(() => {});
  yield* Deferred.await(connected);
  yield* Scope.close(scope, Exit.void);
  assert.equal(connections, 2);
  assert.equal(releases, connections);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 0);
  subscriptions.subscribe(() => {});
  yield* FiberSet.awaitEmpty(subscriptions.fibers);
  assert.equal(connections, 2);
})));

// @feature docs/feature/web-workbench/README.md
test('HTTP subscription drain waits for the slow stopping listener', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const entered = yield* Deferred.make<void>(), finish = yield* Deferred.make<void>();
  let released = false;
  const subscriptions = yield* makeHttpSubscriptions(Stream.make(event('stopping')),
    Effect.acquireRelease(Effect.void, () => Effect.sync(() => { released = true; })));
  subscriptions.subscribe(() => Effect.runPromise(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(finish)))));
  yield* Deferred.await(entered);
  const drain = yield* Effect.forkScoped(FiberSet.awaitEmpty(subscriptions.fibers));
  assert.equal(drain.pollUnsafe(), undefined);
  assert.equal(released, false);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 1);
  yield* Deferred.succeed(finish, undefined);
  yield* Fiber.join(drain);
  assert.equal(released, true);
  assert.equal(yield* FiberSet.size(subscriptions.fibers), 0);
}))));
