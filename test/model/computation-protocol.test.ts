import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Exit, Fiber, Queue, Schema, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Rpc, RpcClient, RpcGroup, RpcMessage, RpcSerialization } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';
import { makeComputationProtocol } from '../../src/entry/server/computation-protocol.ts';

const work = Rpc.make('work', { success: Schema.Int });
const Work = RpcGroup.make(work);
const transport = Effect.gen(function*() {
  const requests = yield* Queue.unbounded<string | Uint8Array>();
  const responses = yield* Queue.unbounded<Uint8Array, Socket.SocketError>();
  const socket = Socket.make({
    runRaw: (handle, options) => (options?.onOpen ?? Effect.void).pipe(Effect.andThen(Stream.runForEach(Stream.fromQueue(responses), chunk => handle(chunk) ?? Effect.void))),
    writer: Effect.succeed(chunk => chunk instanceof Socket.CloseEvent ? Effect.void : Queue.offer(requests, chunk).pipe(Effect.asVoid)),
  });
  const protocol = yield* makeComputationProtocol(socket);
  const client = yield* RpcClient.make(Work).pipe(Effect.provideService(RpcClient.Protocol, protocol));
  const serialization = yield* RpcSerialization.RpcSerialization;
  const peer = serialization.makeUnsafe();
  const received = yield* Deferred.make<string | number>();
  yield* Effect.forkScoped(Stream.runForEach(Stream.fromQueue(requests), bytes => Effect.gen(function*() {
    for (const value of peer.decode(bytes)) {
      const message = Schema.decodeUnknownSync(RpcMessage.EncodedSchema, { onExcessProperty: 'error' })(value);
      if (message._tag === 'Request') yield* Deferred.succeed(received, message.id);
    }
  })));
  return { client, responses, received, peer, encodeResult: Schema.encodeSync(serialization.codecFor(Rpc.exitSchema(work))) };
});

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
// @issue docs/issues/test-architecture-gaps.md
test('owned computation remains pending while its live peer is synchronously busy', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const { client, responses, received, peer, encodeResult } = yield* transport;
  const pending = yield* Effect.forkScoped(client.work());
  const requestId = yield* Deferred.await(received);
  // A stopped/busy process cannot consume either requests or heartbeat bytes.
  // Its independent request deadline still owns the allowed computation time.
  yield* TestClock.adjust('5 seconds');
  yield* TestClock.adjust('6 seconds');
  assert.equal(pending.pollUnsafe(), undefined, 'a live computation must retain its request deadline');
  const response = peer.encode({ _tag: 'Exit', requestId, exit: encodeResult(Exit.succeed(42)) });
  assert.ok(response instanceof Uint8Array);
  yield* Queue.offer(responses, response);
  assert.equal(yield* Fiber.join(pending), 42);
})).pipe(Effect.provide(RpcSerialization.layerSchemaBinary()), Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
test('owned computation fails promptly when its output pipe closes', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const { client, responses, received } = yield* transport;
  const pending = yield* Effect.forkScoped(Effect.result(client.work()));
  yield* Deferred.await(received);
  yield* Queue.fail(responses, new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: new Error('child exited') }) }));
  const result = yield* Fiber.join(pending);
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.equal(result.failure._tag, 'RpcClientError');
})).pipe(Effect.provide(RpcSerialization.layerSchemaBinary()), Effect.provide(TestClock.layer()))));
