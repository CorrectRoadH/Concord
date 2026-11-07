import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { makeWorkspaceService } from '../../src/entry/server/service.ts';
import { ports, record, stateLayer } from '../support/workspace-service-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/maintenance-restarts-computation.md
test('automatic reclamation preserves both computation owners', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let closes = 0, opens = 0, reclaimed = false;
  const service = yield* makeWorkspaceService(ports({
    open: Effect.sync(() => { opens++; }), close: Effect.sync(() => { closes++; }),
    maintenance: { needed: Effect.sync(() => !reclaimed), run: Effect.sync(() => { reclaimed = true; }) },
  }));
  yield* TestClock.adjust(30_000);
  assert.equal(reclaimed, true);
  assert.equal(closes, 0, 'reclamation must not close computation processes');
  assert.equal(opens, 1, 'only initial startup opens computation processes');
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/maintenance-restarts-computation.md
test('a foreground read does not wait behind reclamation draining a background scan', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const scanning = yield* Deferred.make<void>();
  const service = yield* makeWorkspaceService(ports({
    compute: operation => operation.kind === 'scan' ? Deferred.succeed(scanning, undefined).pipe(Effect.andThen(Effect.never)) : Effect.succeed('foreground'),
    maintenance: { needed: Effect.succeed(true), run: Effect.void },
  }));
  yield* Deferred.await(scanning);
  yield* TestClock.adjust(30_000);
  const read = yield* service.execute({ kind: 'source-digest' }).pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.ok(read.pollUnsafe(), 'foreground read must finish while the background scan remains blocked');
  assert.equal(yield* Fiber.join(read), 'foreground');
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/maintenance-restarts-computation.md
test('an arriving foreground request interrupts maintenance and keeps the service usable', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let enabled = false, interrupted = false;
  const entered = yield* Deferred.make<void>();
  const service = yield* makeWorkspaceService(ports({
    compute: () => Effect.succeed(record),
    maintenance: { needed: Effect.sync(() => enabled), run: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never), Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))) },
  }));
  yield* TestClock.adjust(0);
  enabled = true;
  yield* TestClock.adjust(30_000);
  yield* Deferred.await(entered);
  const read = yield* service.execute({ kind: 'source-digest' }).pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.equal(interrupted, true, 'foreground admission cancels idle maintenance');
  assert.ok(read.pollUnsafe());
  assert.deepEqual(yield* Fiber.join(read), record);
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));
