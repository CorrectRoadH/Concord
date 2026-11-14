import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { makeWorkspaceService } from '../../src/entry/server/service.ts';
import { ports, stateLayer } from '../support/workspace-service-fixture.ts';

// @feature docs/feature/local-data-engine/README.md
test('idle service time preserves its computation resources until explicit stop', async () => {
  let closes = 0, opens = 0;
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const service = yield* makeWorkspaceService(ports({
      open: Effect.sync(() => { opens++; }), close: Effect.sync(() => { closes++; }),
    }));
    yield* TestClock.adjust('2 minutes');
    assert.equal(closes, 0, 'elapsed idle time cannot close live resources');
    assert.equal(opens, 1, 'only initial startup opens resources');
    yield* service.stop;
  })).pipe(Effect.provide(stateLayer)));
  assert.equal(closes, 1, 'leaving the stopped service scope closes the resources');
});

// @feature docs/feature/local-data-engine/README.md
test('a foreground read finishes while a background scan remains blocked', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const scanning = yield* Deferred.make<void>();
  const service = yield* makeWorkspaceService(ports({
    compute: operation => operation.kind === 'scan' ? Deferred.succeed(scanning, undefined).pipe(Effect.andThen(Effect.never)) : Effect.succeed('foreground'),
  }));
  yield* Deferred.await(scanning);
  const read = yield* service.execute({ kind: 'source-digest' }).pipe(Effect.forkScoped);
  yield* TestClock.adjust(0);
  assert.ok(read.pollUnsafe(), 'foreground read must finish while the background scan remains blocked');
  assert.equal(yield* Fiber.join(read), 'foreground');
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));

