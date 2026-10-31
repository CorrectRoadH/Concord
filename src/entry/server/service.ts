// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#状态
import { Clock, Deferred, Effect, Fiber, Queue, Schema, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect';
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
  readonly reconcile?: (candidate: WorkspaceProjectionRecord) => Effect.Effect<boolean, unknown>;
}
const namedFailure = (cause: unknown) => {
  const decoded = Schema.decodeUnknownExit(Schema.Struct({ code: Schema.String, message: Schema.String }))(cause);
  return decoded._tag === 'Success' ? new ConcordError(decoded.value.code, decoded.value.message) : failure(cause);
};

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
    const error = namedFailure(cause);
    return state.transition(['CleanupFailed', 'UnsafePath', 'ServerLockUnavailable'].includes(error.code) ? 'blocked' : 'degraded', { code: error.code, message: error.message });
  };
  const refresh = Effect.gen(function*() {
    const status = yield* SubscriptionRef.get(state.value);
    if (stopping || status.state === 'blocked') return;
    yield* ports.verify;
    const context = yield* ports.context;
    yield* ports.ready(context);
    const value = yield* ports.compute({ kind: 'scan' });
    const candidate = yield* Effect.try({ try: () => decodeWorkspaceProjectionRecord(value), catch: failure });
    if (ports.reconcile && (yield* ports.reconcile(candidate))) yield* request;
    yield* ports.verify;
    if ((yield* ports.context).identity !== context.identity) { yield* request; return; }
    yield* ports.ready(context);
    if (stopping) return;
    yield* ports.persist(context, candidate);
    yield* state.accept(yield* ports.restore(context));
    if ((yield* SubscriptionRef.get(state.value)).state === 'running') yield* state.transition('running');
    if (!candidate.consistent) yield* Effect.forkScoped(Effect.sleep('1 second').pipe(Effect.andThen(request)));
  }).pipe(Effect.catch(cause => Effect.gen(function*() {
    const error = namedFailure(cause);
    if (stopping) return;
    if (error.code === 'RepositoryBusy' || error.code === 'SourceChanged') { yield* Effect.forkScoped(Effect.sleep('100 millis').pipe(Effect.andThen(request))); return; }
    const context = yield* Effect.result(ports.context);
    if (context._tag === 'Success') {
      yield* ports.persist(context.success, undefined, error).pipe(Effect.ignore);
      yield* ports.restore(context.success).pipe(Effect.flatMap(state.accept), Effect.ignore);
    }
    const prior = yield* SubscriptionRef.get(state.value);
    if (error.code === 'CleanupFailed') yield* state.transition('blocked', { code: error.code, message: error.message });
    else yield* state.transition(prior.state === 'degraded' ? 'degraded' : 'running', { code: error.code, message: error.message });
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
    yield* Queue.clear(invalidations);
    pending = false;
    yield* maintenance.withPermit(refresh);
  })));
  yield* Effect.forkScoped(Effect.repeat(Effect.gen(function*() { if (!pending) yield* request; }), compensationRefresh).pipe(Effect.delay('30 seconds')));
  yield* Effect.forkScoped(Effect.repeat(maintenance.withPermit(Effect.gen(function*() {
    const current = yield* SubscriptionRef.get(state.value);
    if (current.state !== 'degraded' || !current.error || !['HawdbUnavailable', 'HawdbBusy', 'HawdbClosed'].includes(current.error.code)) return;
    yield* ports.verify;
    yield* ports.open;
    yield* state.transition('running');
    yield* request;
  })).pipe(Effect.ignore), Schedule.spaced('1 second')));
  yield* Effect.forkScoped(Effect.repeat(Effect.gen(function*() {
    const valid = yield* Effect.result(ports.verify);
    if (valid._tag === 'Failure' || !(yield* ports.exists) || connections === 0 && (yield* state.expired)) yield* stop;
  }).pipe(Effect.catch(() => stop)), serviceHeartbeat));
  const clear = maintenance.withPermit(Effect.gen(function*() {
    yield* ports.verify;
    yield* state.transition('draining');
    yield* ports.close;
    yield* ports.verify;
    yield* state.transition('clearing');
    const outcome = yield* Effect.result(ports.clear);
    if (outcome._tag === 'Failure') {
      const error = namedFailure(outcome.failure);
      if (error.code === 'RepositoryBusy') {
        yield* ports.open;
        yield* state.transition('running');
        yield* request;
      } else yield* state.transition('blocked', { code: error.code, message: error.message });
      return yield* Effect.fail(error);
    }
    yield* state.reset;
    yield* state.transition('opening');
    yield* ports.open;
    yield* state.transition('running');
    yield* request;
    return outcome.success;
  }));
  yield* Effect.addFinalizer(() => stop.pipe(Effect.andThen(Fiber.interrupt(refreshFiber)), Effect.andThen(ports.close), Effect.orDie));
  return { state, stopped: Deferred.await(stopped), stop, request, invalidate, clear,
    drain: maintenance.withPermit(Effect.void),
    connect: Effect.acquireRelease(Effect.sync(() => { connections++; }), () => Effect.sync(() => { connections--; })),
    execute: (operation: Computation) => maintenance.withPermit(Effect.gen(function*() {
      yield* ports.verify;
      const current = yield* SubscriptionRef.get(state.value);
      if (!['running', 'degraded'].includes(current.state)) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', `Service is ${current.state}`));
      yield* state.touch;
      return yield* ports.compute(operation);
    })),
  };
});
