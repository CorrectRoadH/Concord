import assert from 'node:assert/strict';
import { Socket } from 'node:net';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import * as RpcClient from 'effect/unstable/rpc/RpcClient';
import { RpcClientError } from 'effect/unstable/rpc/RpcClientError';
import { SocketOpenError } from 'effect/unstable/socket/Socket';
import { connectWorkspaceSocket, requestWorkspace, WorkspaceRpcs, WorkspaceServerError, PROTOCOL } from '../../src/entry/server/index.ts';

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

// @feature docs/feature/local-data-engine/README.md
test('a query transport open timeout stays WorkspaceServerUnavailable after the handshake', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const transport = new RpcClientError({ reason: new SocketOpenError({ kind: 'Timeout', cause: new Error('ping timeout') }) });
  const { client } = yield* RpcClient.makeNoSerialization(WorkspaceRpcs, { onFromClient: () => Effect.fail(transport) });
  const result = yield* requestWorkspace({
    client, hello: { protocol: PROTOCOL, installation: 'installation', token: 'token', state: 'running', sourceDigest: null },
    identity: () => ({ token: 'token', installation: 'installation', requestId: 'request', deadline: Number.MAX_SAFE_INTEGER }),
  }, 'query', { name: 'test-list', input: {}, cwd: '/fixture', environment: {}, cache: 'use' }).pipe(Effect.result);
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') {
    assert.ok(result.failure instanceof WorkspaceServerError);
    assert.equal(result.failure.code, 'WorkspaceServerUnavailable');
  }
}))));
