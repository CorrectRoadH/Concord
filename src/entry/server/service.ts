// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#状态
import { Clock, Deferred, Effect, Fiber, Queue, Schema, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect';
import { ConcordError, failure, decodeWorkspaceProjectionCandidate, type WorkspaceProjection, type WorkspaceProjectionCandidate } from '../../model/index.ts';
import type { WorkspaceProjectionContext } from '../../model/index.ts';
import { WorkspaceState, compensationRefresh, serviceHeartbeat } from './state.ts';
import type { Computation } from './computation.ts';

export interface RuntimePorts {
  readonly verify: Effect.Effect<void, unknown>;
  readonly health?: Effect.Effect<void, unknown>;
  readonly sourceDigest: Effect.Effect<string, unknown>;
  readonly context: Effect.Effect<WorkspaceProjectionContext, unknown>;
  readonly ready: (context: WorkspaceProjectionContext) => Effect.Effect<void, unknown>;
  readonly restore: (context: WorkspaceProjectionContext) => Effect.Effect<WorkspaceProjection, unknown>;
  readonly persist: (context: WorkspaceProjectionContext, candidate?: WorkspaceProjectionCandidate, error?: ConcordError, attempt?: WorkspaceProjection['projection']['lastAttempt']) => Effect.Effect<void, unknown>;
  readonly compute: (operation: Computation) => Effect.Effect<unknown, unknown>;
  readonly open: Effect.Effect<void, unknown>;
  readonly close: Effect.Effect<void, unknown>;
  readonly clear: Effect.Effect<unknown, unknown>;
  readonly maintenance?: { readonly needed: Effect.Effect<boolean, unknown>; readonly run: Effect.Effect<unknown, unknown> };
  readonly exists: Effect.Effect<boolean, unknown>;
  readonly reconcile?: (candidate: WorkspaceProjectionCandidate) => Effect.Effect<boolean, unknown>;
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
  let operations = 0;
  let operationIdle = yield* Deferred.make<void>();
  yield* Deferred.succeed(operationIdle, undefined);
  const operationsDrained = Effect.suspend(() => Deferred.await(operationIdle));
  let stopping = false, connections = 0, lastInvalidation = -Infinity, firstInvalidation = -Infinity;
  let pending = false;
  let identity: string | undefined;
  const synchronizeIdentity = (context: WorkspaceProjectionContext) => Effect.gen(function*() {
    if (identity === context.identity) return;
    identity = context.identity;
    yield* state.reset;
  });
  const current = Effect.gen(function*() {
    const context = yield* ports.context;
    if (identity !== context.identity) { yield* synchronizeIdentity(context); yield* request; }
    return yield* SubscriptionRef.get(state.value);
  });
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
  const discard = (context: WorkspaceProjectionContext, changedPaths: readonly string[]) => Effect.gen(function*() {
    yield* synchronizeIdentity(context);
    const attempt = { at: new Date(yield* Clock.currentTimeMillis).toISOString(), complete: false, changedPaths };
    yield* ports.persist(context, undefined, undefined, attempt);
    yield* ports.restore(context).pipe(Effect.flatMap(state.accept), Effect.ignore);
    yield* state.attempt(attempt);
    yield* Effect.forkScoped(Effect.sleep('1 second').pipe(Effect.andThen(request)));
  });
  const refresh = Effect.gen(function*() {
    const status = yield* SubscriptionRef.get(state.value);
    if (stopping || status.state === 'blocked') return;
    yield* ports.verify;
    const context = yield* ports.context;
    yield* synchronizeIdentity(context);
    yield* ports.ready(context);
    const sourceDigest = yield* ports.sourceDigest;
    const value = yield* ports.compute({ kind: 'scan' });
    const candidate = yield* Effect.try({ try: () => decodeWorkspaceProjectionCandidate(value), catch: failure });
    if (ports.reconcile && (yield* ports.reconcile(candidate))) yield* request;
    yield* ports.verify;
    const after = yield* ports.context;
    if (after.identity !== context.identity) { yield* synchronizeIdentity(after); yield* request; return; }
    yield* ports.ready(context);
    if (stopping) return;
    if (candidate.sourceDigest === undefined) { yield* discard(context, candidate.changedPaths); return; }
    if (candidate.sourceDigest !== sourceDigest || (yield* ports.sourceDigest) !== sourceDigest) { yield* discard(context, ['.']); return; }
    yield* ports.persist(context, candidate);
    yield* state.accept(yield* ports.restore(context));
    if ((yield* SubscriptionRef.get(state.value)).state === 'running') yield* state.transition('running');
  }).pipe(Effect.catch(cause => Effect.gen(function*() {
    const error = namedFailure(cause);
    if (stopping) return;
    if (error.code === 'RepositoryBusy') { yield* Effect.forkScoped(Effect.sleep('100 millis').pipe(Effect.andThen(request))); return; }
    if (error.code === 'SourceChanged') {
      const context = yield* Effect.result(ports.context);
      if (context._tag === 'Success') yield* discard(context.success, ['.']);
      else yield* Effect.forkScoped(Effect.sleep('1 second').pipe(Effect.andThen(request)));
      return;
    }
    const context = yield* Effect.result(ports.context);
    if (context._tag === 'Success') {
      yield* synchronizeIdentity(context.success);
      yield* ports.persist(context.success, undefined, error).pipe(Effect.ignore);
      yield* ports.restore(context.success).pipe(Effect.flatMap(state.accept), Effect.ignore);
    }
    const prior = yield* SubscriptionRef.get(state.value);
    if (error.code === 'CleanupFailed') yield* state.transition('blocked', { code: error.code, message: error.message });
    else yield* state.transition(prior.state === 'degraded' ? 'degraded' : 'running', prior.state === 'degraded' && prior.error ? prior.error : { code: error.code, message: error.message });
  })));
  const stop = Effect.suspend(() => {
    if (stopping) return Effect.void;
    stopping = true;
    return state.transition('stopping').pipe(Effect.andThen(Deferred.succeed(stopped, undefined)), Effect.asVoid);
  });
  const maintain = <A, E, R>(operation: Effect.Effect<A, E, R>) => maintenance.withPermit(Effect.gen(function*() {
    yield* ports.verify;
    const current = yield* SubscriptionRef.get(state.value);
    if (!['running', 'degraded'].includes(current.state)) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', `Service is ${current.state}`));
    yield* state.touch;
    return yield* operation;
  }));
  const operate = <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.scoped(maintain(Effect.acquireRelease(Effect.gen(function*() {
    if (operations === 0) operationIdle = yield* Deferred.make<void>();
    operations++;
  }), () => Effect.suspend(() => {
    operations--;
    return operations === 0 ? Deferred.succeed(operationIdle, undefined).pipe(Effect.asVoid) : Effect.void;
  }))).pipe(Effect.andThen(operation)));
  const startup = Effect.gen(function*() {
    yield* ports.open;
    const context = yield* ports.context;
    yield* synchronizeIdentity(context);
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
    yield* operate(refresh);
  })));
  yield* Effect.forkScoped(Effect.repeat(Effect.gen(function*() { if (!pending) yield* request; }), compensationRefresh).pipe(Effect.delay('30 seconds')));
  yield* Effect.forkScoped(Effect.repeat(maintenance.withPermit(Effect.gen(function*() {
    const current = yield* SubscriptionRef.get(state.value);
    if (current.state === 'running' && ports.health) {
      const health = yield* Effect.result(ports.health);
      if (health._tag === 'Failure') { yield* operationsDrained; yield* ports.close; yield* fail(health.failure); yield* request; }
      return;
    }
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
    yield* operationsDrained;
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
  if (ports.maintenance) {
    const idleMaintenance = ports.maintenance;
    yield* Effect.forkScoped(Effect.repeat(maintenance.withPermit(Effect.gen(function*() {
      if (stopping || operations > 0 || (yield* SubscriptionRef.get(state.value)).state !== 'running' || !(yield* idleMaintenance.needed)) return;
      yield* ports.verify;
      yield* state.transition('draining');
      yield* ports.close;
      if (stopping) return;
      yield* state.transition('maintaining');
      yield* idleMaintenance.run;
      if (stopping) return;
      yield* state.transition('opening');
      yield* ports.open;
      yield* state.transition('running');
      yield* request;
    })).pipe(Effect.catch(fail)), Schedule.spaced('30 seconds')));
  }
  return { state, current, stopped: Deferred.await(stopped), stop, request, invalidate, clear,
    maintain, operate,
    drain: maintenance.withPermit(operationsDrained),
    connect: Effect.acquireRelease(Effect.sync(() => { connections++; }), () => Effect.sync(() => { connections--; })),
    execute: (operation: Computation) => maintain(ports.compute(operation)),
  };
});
