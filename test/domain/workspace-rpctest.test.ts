import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import * as RpcTest from 'effect/unstable/rpc/RpcTest';
import { WorkspaceRpcs, WorkspaceServerError, FRAME_LIMIT, collectPackets } from '../../src/entry/server/index.ts';
import { makeOutputAdmission, packets } from '../../src/entry/server/protocol.ts';

const workspaceRpcs = WorkspaceRpcs.omit('hello', 'shutdown', 'subscribe', 'refresh', 'read', 'query', 'git-status', 'git-diff', 'http', 'cache-clear', 'cache-status', 'cache-rebuild', 'cache-snapshot', 'cache-derived', 'feedback-merge');
const identity = { token: 'instance', installation: 'installation', deadline: Number.MAX_SAFE_INTEGER };

// @feature docs/feature/local-data-engine/README.md
test('RpcTest workspace streams complete production packets before returning multi-frame JSON', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const value = { sourceDigest: 'accepted-source', text: '文🙂'.repeat(FRAME_LIMIT / 4) };
  const output = makeOutputAdmission();
  const handlers = workspaceRpcs.toLayer({ workspace: () => output.json(value) });
  const client = yield* RpcTest.makeClient(workspaceRpcs).pipe(Effect.provide(handlers));
  const frames: { size: number; last: boolean }[] = [];
  const actual = yield* collectPackets(client.workspace({ ...identity, requestId: 'complete' }).pipe(Stream.tap(packet => Effect.sync(() => {
    frames.push({ size: packet.data.byteLength, last: packet.last });
  }))));
  assert.deepEqual(actual, value);
  assert.ok(frames.length > 1);
  assert.ok(frames.every(frame => frame.size <= FRAME_LIMIT));
  assert.deepEqual(frames.map(frame => frame.last), frames.map((_, index) => index === frames.length - 1));
})).pipe(Effect.timeout('10 seconds'))));

// @feature docs/feature/local-data-engine/README.md
test('RpcTest workspace collection rejects a completed transport missing the final production packet', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const bytes = new TextEncoder().encode(JSON.stringify({ text: 'x'.repeat(FRAME_LIMIT) }));
  const handlers = workspaceRpcs.toLayer({ workspace: () => packets(bytes).pipe(Stream.take(1)) });
  const client = yield* RpcTest.makeClient(workspaceRpcs).pipe(Effect.provide(handlers));
  const result = yield* collectPackets(client.workspace({ ...identity, requestId: 'incomplete' })).pipe(Effect.result);
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') {
    assert.ok(result.failure instanceof WorkspaceServerError);
    assert.equal(result.failure.code, 'WorkspaceServerProtocol');
    assert.equal(result.failure.message, 'Incomplete result');
  }
})).pipe(Effect.timeout('10 seconds'))));

// @feature docs/feature/local-data-engine/README.md
test('RpcTest cancellation releases production output admission and preserves named busy failures', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const output = makeOutputAdmission();
  const bytes = new Uint8Array(32 * FRAME_LIMIT);
  const firstReady = yield* Deferred.make<void>(), secondReady = yield* Deferred.make<void>();
  const firstClosed = yield* Deferred.make<void>(), secondClosed = yield* Deferred.make<void>();
  const handlers = workspaceRpcs.toLayer({ workspace: request => Stream.unwrap(Effect.gen(function*() {
    const closed = request.requestId === 'first' ? firstClosed : secondClosed;
    const ready = request.requestId === 'first' ? firstReady : secondReady;
    // Register before the production reservation so this signal follows its release.
    if (request.requestId === 'first' || request.requestId === 'second') yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
    const stream = output.bytes(bytes);
    return request.requestId === 'first' || request.requestId === 'second'
      ? stream.pipe(Stream.tap(() => Deferred.succeed(ready, undefined).pipe(Effect.andThen(Effect.never))))
      : stream.pipe(Stream.take(1));
  })) });
  const client = yield* RpcTest.makeClient(workspaceRpcs).pipe(Effect.provide(handlers));
  const first = yield* Stream.runDrain(client.workspace({ ...identity, requestId: 'first' })).pipe(Effect.forkScoped);
  yield* Deferred.await(firstReady);
  const second = yield* Stream.runDrain(client.workspace({ ...identity, requestId: 'second' })).pipe(Effect.forkScoped);
  yield* Deferred.await(secondReady);
  const blocked = yield* Stream.runDrain(client.workspace({ ...identity, requestId: 'blocked' })).pipe(Effect.result);
  assert.equal(blocked._tag, 'Failure');
  if (blocked._tag === 'Failure') {
    assert.ok(blocked.failure instanceof WorkspaceServerError);
    assert.equal(blocked.failure.code, 'WorkspaceServerBusy');
    assert.equal(blocked.failure.message, 'Pending output exceeds 64 MiB');
  }
  yield* Fiber.interrupt(first);
  yield* Deferred.await(firstClosed);
  const replacement = yield* Stream.runCollect(client.workspace({ ...identity, requestId: 'replacement' }));
  assert.equal(replacement.length, 1, 'a cancelled request must make its byte reservation reusable');
  assert.equal(replacement[0]?.data.byteLength, FRAME_LIMIT - 4096);
  yield* Fiber.interrupt(second);
  yield* Deferred.await(secondClosed);
})).pipe(Effect.timeout('10 seconds'))));
