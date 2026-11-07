import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { connectWorkspaceSocket, WorkspaceServerError } from '../../src/entry/server/index.ts';

// @feature docs/feature/local-data-engine/README.md
// @issue docs/issues/command-server-socket-open-timeout.md
test('parallel client socket opens share their handshake deadline and report named unavailability', async t => {
  const sockets: Socket[] = [];
  const opened = Deferred.makeUnsafe<void>();
  t.mock.method(Socket.prototype, 'connect', function(this: Socket) {
    sockets.push(this);
    if (sockets.length === 3) Deferred.doneUnsafe(opened, Effect.void);
    return this;
  });
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const waiting = yield* Effect.forkScoped(Effect.forEach([0, 1, 2], index => Effect.scoped(
      connectWorkspaceSocket(`delayed-${index}.sock`, 'installation', 'token').pipe(Effect.result),
    ), { concurrency: 'unbounded' }));
    yield* Deferred.await(opened);
    yield* TestClock.adjust(999);
    assert.equal(waiting.pollUnsafe(), undefined);
    yield* TestClock.adjust(1);
    for (const result of yield* Fiber.join(waiting)) {
      assert.equal(result._tag, 'Failure');
      if (result._tag === 'Failure') {
        assert.ok(result.failure instanceof WorkspaceServerError);
        assert.equal(result.failure.code, 'WorkspaceServerUnavailable');
      }
    }
  })).pipe(Effect.provide(TestClock.layer())));
  assert.equal(sockets.length, 3);
  assert.ok(sockets.every(socket => socket.destroyed));
});
