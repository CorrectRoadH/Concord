import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { makeWorkspaceService } from '../../src/entry/server/service.ts';
import { ports, stateLayer } from '../support/workspace-service-fixture.ts';

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
test('scheduled reclamation waits for an idle turn without closing computation owners', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  let needed = false, maintained = 0, closed = 0;
  const release = yield* Deferred.make<void>();
  const entered = yield* Deferred.make<void>();
  const service = yield* makeWorkspaceService(ports({
    close: Effect.sync(() => { closed++; }),
    maintenance: {
      needed: Effect.sync(() => needed),
      run: Effect.sync(() => { maintained++; needed = false; }),
    },
  }));
  yield* TestClock.adjust(0);
  const operation = yield* Effect.forkScoped(service.operate(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))));
  yield* Deferred.await(entered);
  needed = true;
  yield* TestClock.adjust('30 seconds');
  assert.equal(closed, 0, 'maintenance cannot close resources while accepted work is active');
  assert.equal(maintained, 0);
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(operation);
  yield* TestClock.adjust('30 seconds');
  assert.equal(maintained, 1, 'reclamation runs on the next idle turn');
  assert.equal(closed, 0, 'automatic reclamation does not close computation owners');
  yield* service.stop;
})).pipe(Effect.provide(stateLayer))));
