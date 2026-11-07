import assert from 'node:assert/strict';
import test from 'node:test';
import { Deferred, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { watchComputation } from '../../src/entry/server/computation-watchdog.ts';

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
test('a stalled computation fails after sixty seconds without CPU or responses', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const sampled = yield* Deferred.make<void>();
  const cpu = Deferred.succeed(sampled, undefined).pipe(Effect.as(new Map([['worker', 10]])));
  const running = yield* Effect.forkScoped(watchComputation(cpu, () => 0).pipe(Effect.result));
  yield* Deferred.await(sampled);
  yield* TestClock.adjust('60 seconds');
  const result = yield* Fiber.join(running);
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') assert.equal((result.failure as { code: string }).code, 'ComputeUnresponsive');
})).pipe(Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
test('CPU progress cannot extend the six hundred second request budget', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const sampled = yield* Deferred.make<void>();
  let ticks = 0;
  const cpu = Deferred.succeed(sampled, undefined).pipe(Effect.andThen(Effect.sync(() => new Map([['worker', ++ticks]]))));
  const running = yield* Effect.forkScoped(watchComputation(cpu, () => 0).pipe(Effect.result));
  yield* Deferred.await(sampled);
  yield* TestClock.adjust('600 seconds');
  const result = yield* Fiber.join(running);
  assert.equal(result._tag, 'Failure');
  if (result._tag === 'Failure') {
    assert.equal((result.failure as { code: string }).code, 'ComputeRequestTimedOut');
    assert.deepEqual((result.failure as { details: unknown }).details, { elapsedMs: 600_000, limitMs: 600_000 });
  }
})).pipe(Effect.provide(TestClock.layer()))));

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
test('responses keep an otherwise idle computation alive until its total budget', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const sampled = yield* Deferred.make<void>();
  let responses = 0;
  const cpu = Deferred.succeed(sampled, undefined).pipe(Effect.as(new Map<string, number>()));
  const running = yield* Effect.forkScoped(watchComputation(cpu, () => ++responses).pipe(Effect.result));
  yield* Deferred.await(sampled);
  yield* TestClock.adjust('80 seconds');
  assert.equal(running.pollUnsafe(), undefined);
  yield* Fiber.interrupt(running);
})).pipe(Effect.provide(TestClock.layer()))));
