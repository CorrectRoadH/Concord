import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { waitForWorkspaceResult } from '../../src/entry/server/index.ts';
import { ConcordError } from '../../src/model/index.ts';

const event = (sourceDigest: string | null, state = 'running') => ({ token: 'instance', sourceDigest, state });

// @feature docs/feature/local-data-engine/cli.md#等待下一份结果
test('workspace wait returns the initial or next accepted digest and ignores failed refreshes', () => Effect.runPromise(Effect.gen(function*() {
  for (const after of [undefined, 'old']) assert.deepEqual(yield* waitForWorkspaceResult(Stream.make(event('current')), after, 25), { operation: 'workspace-wait', changed: true, sourceDigest: 'current' });
  const reply = yield* waitForWorkspaceResult(Stream.make(event('old'), { ...event('old', 'degraded'), error: { code: 'RefreshFailed', message: 'retry' } }, event('new')), 'old', 25);
  assert.deepEqual(reply, { operation: 'workspace-wait', changed: true, sourceDigest: 'new' });
})));

// @feature docs/feature/local-data-engine/cli.md#等待下一份结果
test('workspace wait timeouts report the current digest including an absent first result and release subscriptions', () => Effect.runPromise(Effect.gen(function*() {
  for (const current of [null, 'same']) {
    const subscribed = yield* Deferred.make<void>(); let released = false;
    const events = Stream.concat(Stream.make(event(current)), Stream.never).pipe(Stream.ensuring(Effect.sync(() => { released = true; })));
    const fiber = yield* Effect.forkScoped(waitForWorkspaceResult(events.pipe(Stream.tap(() => Deferred.succeed(subscribed, undefined))), current ?? undefined, 25));
    yield* Deferred.await(subscribed); yield* TestClock.adjust('25 seconds');
    assert.deepEqual(yield* Fiber.join(fiber), { operation: 'workspace-wait', changed: false, sourceDigest: current });
    assert.equal(released, true);
  }
}).pipe(Effect.scoped, Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/cli.md#等待下一份结果
test('workspace wait reports service termination and releases an interrupted caller subscription', () => Effect.runPromise(Effect.gen(function*() {
  for (const events of [Stream.make(event('same'), event('same', 'stopping')), Stream.empty]) {
    const result = yield* Effect.result(waitForWorkspaceResult(events, 'same', 25));
    assert.equal(result._tag, 'Failure');
    if (result._tag === 'Failure') { assert.ok(result.failure instanceof ConcordError); assert.equal(result.failure.code, 'WorkspaceServerUnavailable'); }
  }
  let released = false; const subscribed = yield* Deferred.make<void>();
  const events = Stream.concat(Stream.fromEffect(Deferred.succeed(subscribed, undefined).pipe(Effect.as(event('same')))), Stream.never).pipe(Stream.ensuring(Effect.sync(() => { released = true; })));
  const fiber = yield* Effect.forkScoped(waitForWorkspaceResult(events, 'same', 25));
  yield* Deferred.await(subscribed); yield* Fiber.interrupt(fiber);
  assert.equal(released, true);
}).pipe(Effect.scoped)));
