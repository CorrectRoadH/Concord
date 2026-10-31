// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#状态
import { Clock, Deferred, Effect, Fiber, Queue, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect';
import { ConcordError, failure, decodeWorkspaceProjectionRecord, type WorkspaceProjection, type WorkspaceProjectionRecord } from '../../model/index.js';
import type { WorkspaceProjectionContext } from '../../model/index.js';
import { WorkspaceState, compensationRefresh, serviceHeartbeat } from './state.js';
import type { Computation } from './computation.js';

export interface RuntimePorts {
  readonly verify: Effect.Effect<void, unknown>;
  readonly context: Effect.Effect<WorkspaceProjectionContext, unknown>;
  readonly ready: (context: WorkspaceProjectionContext) => Effect.Effect<void, unknown>;
  readonly restore: (context: WorkspaceProjectionContext) => Effect.Effect<WorkspaceProjection, unknown>;
  readonly persist: (context: WorkspaceProjectionContext, candidate?: WorkspaceProjectionRecord, error?: ConcordError) => Effect.Effect<void, unknown>;
  readonly compute: (operation: Computation) => Effect.Effect<unknown, unknown>;
  readonly open: Effect.Effect<void, unknown>;
  readonly close: Effect.Effect<void, unknown>;
  readonly clear: Effect.Effect<unknown, unknown>;
  readonly exists: Effect.Effect<boolean, unknown>;
}

/** Production scheduling uses the same Clock-driven state machine as tests. */
export const makeWorkspaceService = Effect.fn('makeWorkspaceService')(function*(ports: RuntimePorts) {
  const state = yield* WorkspaceState;
  const stopped = yield* Deferred.make<void>();
  const invalidations = yield* Queue.sliding<void>(1);
  const maintenance = yield* Semaphore.make(1);
  let stopping = false, connections = 0, lastInvalidation = -Infinity, firstInvalidation = -Infinity;
  let pending = false;
  const request = Effect.suspend(() => {
    if (stopping) return Effect.void;
    pending = true;
    return Queue.offer(invalidations, undefined).pipe(Effect.asVoid);
  });
  const invalidate = Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis;
    if (!Number.isFinite(firstInvalidation)) firstInvalidation = now;
    lastInvalidation = now;
    yield* request;
  });
  const fail = (cause: unknown) => {
    const error = failure(cause);
    return state.transition(error.code === 'CleanupFailed' ? 'blocked' : 'degraded', { code: error.code, message: error.message });
  };
  const refresh = Effect.gen(function*() {
    const status = yield* SubscriptionRef.get(state.value);
    if (stopping || status.state === 'blocked') return;
    yield* ports.verify;
    const context = yield* ports.context;
    yield* ports.ready(context);
    const value = yield* ports.compute({ kind: 'scan' });
    const candidate = yield* Effect.try({ try: () => decodeWorkspaceProjectionRecord(value), catch: failure });
    yield* ports.verify;
    if ((yield* ports.context).identity !== context.identity) { yield* request; return; }
    yield* ports.ready(context);
    if (stopping) return;
    yield* ports.persist(context, candidate);
    yield* state.accept(yield* ports.restore(context));
    if (!candidate.consistent) yield* Effect.forkScoped(Effect.sleep('1 second').pipe(Effect.andThen(request)));
  }).pipe(Effect.catch(cause => Effect.gen(function*() {
    const error = failure(cause);
    if (stopping) return;
    const context = yield* Effect.result(ports.context);
    if (context._tag === 'Success') {
      yield* ports.persist(context.success, undefined, error).pipe(Effect.ignore);
      yield* ports.restore(context.success).pipe(Effect.flatMap(state.accept), Effect.ignore);
    }
    yield* fail(cause);
  })));
  const stop = Effect.suspend(() => {
    if (stopping) return Effect.void;
    stopping = true;
    return state.transition('stopping').pipe(Effect.andThen(Deferred.succeed(stopped, undefined)), Effect.asVoid);
  });
  const startup = Effect.gen(function*() {
    yield* ports.open;
    const context = yield* ports.context;
    yield* ports.restore(context).pipe(Effect.flatMap(state.accept), Effect.ignore);
    yield* state.transition('running');
  }).pipe(Effect.catch(fail), Effect.andThen(request));
  yield* Effect.forkScoped(startup);
  const refreshFiber = yield* Effect.forkScoped(Effect.forever(Effect.gen(function*() {
    yield* Queue.take(invalidations);
    while (Number.isFinite(firstInvalidation)) {
      const now = yield* Clock.currentTimeMillis;
      const delay = Math.min(lastInvalidation + 250, firstInvalidation + 2000) - now;
      if (delay <= 0) break;
      yield* Effect.sleep(delay);
    }
    firstInvalidation = -Infinity;
    pending = false;
    yield* maintenance.withPermit(refresh);
  })));
  yield* Effect.forkScoped(Effect.repeat(Effect.gen(function*() { if (!pending) yield* request; }), compensationRefresh));
  yield* Effect.forkScoped(Effect.repeat(Effect.gen(function*() {
    const valid = yield* Effect.result(ports.verify);
    if (valid._tag === 'Failure' || !(yield* ports.exists) || connections === 0 && (yield* state.expired)) yield* stop;
  }).pipe(Effect.catch(() => stop)), serviceHeartbeat));
  const clear = maintenance.withPermit(Effect.gen(function*() {
    yield* state.transition('draining');
    yield* ports.close;
    yield* state.transition('clearing');
    const result = yield* ports.clear;
    yield* state.transition('opening');
    yield* ports.open;
    yield* state.transition('running');
    yield* request;
    return result;
  }).pipe(Effect.catch(cause => fail(cause).pipe(Effect.andThen(Effect.fail(cause))))));
  yield* Effect.addFinalizer(() => stop.pipe(Effect.andThen(Fiber.interrupt(refreshFiber)), Effect.andThen(ports.close), Effect.orDie));
  return { state, stopped: Deferred.await(stopped), stop, request, invalidate, clear,
    connect: Effect.acquireRelease(Effect.sync(() => { connections++; }), () => Effect.sync(() => { connections--; })),
    execute: (operation: Computation) => maintenance.withPermit(ports.verify.pipe(Effect.andThen(state.touch), Effect.andThen(ports.compute(operation)))),
  };
});
