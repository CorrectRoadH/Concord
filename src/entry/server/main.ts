import { RuntimeEnvironment, makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
import type * as CacheTypes from '../../base/cache/index.ts';
import type * as ProcessTypes from '../../base/process/index.ts';
import type * as RpcGroupTypes from 'effect/rpc/RpcGroup';
import type * as RpcClientErrorTypes from 'effect/rpc/RpcClientError';
import { RpcClientError } from 'effect/rpc/RpcClientError';
import type * as ModelTypes from '../../model/index.ts';
import type * as AppTypes from '../../app/index.ts';
import { Installation } from '../../base/installation/index.ts';
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.ts";
import { PublicationValidationLive } from "../../app/index.ts";
import { Workspace } from '../../base/workspace/index.ts';
import { Sources, type SourceWatch } from '../../base/sources/index.ts';
import { Cache, CacheSnapshot, CacheDerivations, PersistentCache, ContentCacheOwner } from '../../base/cache/index.ts';
import type { ReadonlyCacheSnapshot } from '../../base/cache/index.ts';
import type { CacheDerivationBatch } from '../../model/index.ts';
import type { ChildProcessSpawner } from 'effect/process';
import { NodeSocketServer } from '@effect/platform-node';
import { Cause, Clock, Deferred, Exit, Fiber, FiberSet, Queue, Schema, Scope, Semaphore, Stdio, Stream, SubscriptionRef } from 'effect';
import { RpcClient, RpcSerialization, RpcServer } from 'effect/rpc';
import { Socket, SocketServer } from 'effect/socket';
import { ServerRuntime } from '../../base/server-lock/index.ts';
import { Git } from '../../base/git/index.ts';
import { OwnedProcess, OwnedProcessLive, ProcessEventsLive, makeProcessGroupCpuReader, makeOwnedProcessService, recordProcessEvent } from '../../base/process/index.ts';
import { existsSync } from 'node:fs';
import { channel } from 'node:diagnostics_channel';
import { join } from 'node:path';
import { executeQuery, workspaceSourceDigest, observeWorkspaceProjection, makeWorkspaceProjectionCandidate, getViewFile, getViewGitStatus, getGitDiff, compileP5, workspaceProjectionContext, readWorkspaceProjection, storeWorkspaceProjection, type GitBaselineCache, closeGitBaselineCache } from '../../app/index.ts';
import { CacheSnapshotUnavailable, ConcordError, failure, objectDigest } from '../../model/index.ts';
import { Computation, ComputationReply, ComputeRpcs } from './computation.ts';
import { makeComputationProtocol } from './computation-protocol.ts';
import { watchComputation } from './computation-watchdog.ts';
import { WorkspaceRpcs, WorkspaceServerError, FRAME_LIMIT, PROTOCOL, CommandScope, jsonPackets, ReadCodec, packets, makeOutputAdmission, collectPackets, collectBytes } from './protocol.ts';
import { makeAdmittedProtocol } from './admission.ts';
import { makeRequestAdmission } from './request-admission.ts';
import { getWorkspaceRead } from '../../app/index.ts';
import { QueryRefreshRequest, refreshQuery as refreshDiagnosticQuery } from '../../app/index.ts';
import { workspaceEvents, WorkspaceState, serviceHeartbeat as importServiceHeartbeat } from './state.ts';
import { makeWorkspaceService } from './service.ts';
import { FeedbackSessions } from './feedback-session.ts';
import { DerivationSessions } from './derivation-session.ts';
import { makeHttpLeases } from './http-leases.ts';
import { makeHttpSubscriptions } from './subscriptions.ts';
import { startHostedViewServer, type HostedViewPorts } from '../http/index.ts';
import { FeedbackCacheWriter } from '../../base/cache/index.ts';
import { mergeLocalFeedbackObservation } from '../../domain/feedback/index.ts';
import type { RemoteFeedback } from '../../model/index.ts';
import { clearWorkspaceCache, decodeViewAction, KnowledgeSearch, makeKnowledgeSearchOwner } from '../../app/index.ts';
import { Snapshot } from './computation.ts';
import { assertWorkspacePublicationReady } from '../../app/index.ts';
import { computeCacheRebuild, finishCacheRebuild } from '../../app/index.ts';

import { OperationReply, OperationReady } from './operation-protocol.ts';
const makeOperationOwner = Effect.fn('makeOperationOwner')(function*(root: string, snapshot: Effect.Effect<CacheTypes.ReadonlyCacheSnapshot, unknown>, acceptDerived: (rows: readonly CacheDerivationBatch[]) => Effect.Effect<void, unknown>) {
  const installation = yield* Installation;
  const execution = yield* RuntimeEnvironment;
  const scope = yield* Effect.scope;
  const selection = yield* Semaphore.make(1);
  type Worker = {
    readonly owner: ReturnType<typeof makeOwnedProcessService>;
    readonly ready: Deferred.Deferred<void, ConcordError>;
    readonly input: Deferred.Deferred<{ write: (bytes: string | Uint8Array) => void; end: () => void }>;
    readonly result: Deferred.Deferred<ProcessTypes.OwnedProcessResult, ConcordError>;
    header: string;
    used: boolean;
  };
  const workers = new Set<Worker>();
  let idle: Worker | undefined, enabled = false, unconfirmed = false;
  const ensureClean = Effect.suspend(() => unconfirmed ? Effect.fail(new ConcordError('CleanupFailed', 'Operation process cleanup is unconfirmed')) : Effect.void);
  const inspect = (worker: Worker) => worker.owner.cleanupResults.pipe(Effect.flatMap(results => {
    if (results.some(result => !OwnedProcess.confirmed(result))) { unconfirmed = true; return ensureClean; }
    workers.delete(worker); return Effect.void;
  }));
  const stopWorker = (worker: Worker) => worker.owner.requestStop('SIGTERM').pipe(Effect.andThen(worker.owner.stop('SIGTERM')), Effect.andThen(Deferred.await(worker.result).pipe(Effect.ignore)), Effect.andThen(inspect(worker)));
  const start: Effect.Effect<Worker, ConcordError> = Effect.gen(function*() {
    yield* ensureClean;
    const worker: Worker = { owner: makeOwnedProcessService({ environment: execution }), ready: yield* Deferred.make<void, ConcordError>(), input: yield* Deferred.make<{ write: (bytes: string | Uint8Array) => void; end: () => void }>(), result: yield* Deferred.make<ProcessTypes.OwnedProcessResult, ConcordError>(), header: '', used: false };
    workers.add(worker);
    let buffered = '', received = false;
    const exited = new ConcordError('OperationResultUnknown', 'Operation process ended before accepting a request');
    yield* Effect.forkIn(Effect.scoped(worker.owner.run([process.execPath, ...installation.worker('operation-worker')], {
      cwd: execution.cwd, outputLimitBytes: 32 * FRAME_LIMIT,
      stream: {
        ready: (write, end) => { Deferred.doneUnsafe(worker.input, Effect.succeed({ write, end })); },
        stdout: chunk => {
          if (received) return;
          buffered += chunk.toString('utf8');
          const newline = buffered.indexOf('\n');
          if (newline < 0 && Buffer.byteLength(buffered) <= 4096) return;
          received = true;
          try {
            if (newline < 0 || newline > 4096) throw new Error('Operation readiness exceeds its frame limit');
            const header = buffered.slice(0, newline);
            Schema.decodeUnknownSync(Schema.fromJsonString(OperationReady), { onExcessProperty: 'error' })(header);
            worker.header = `${header}\n`;
            Deferred.doneUnsafe(worker.ready, Effect.void);
          } catch { Deferred.doneUnsafe(worker.ready, Effect.fail(new ConcordError('WorkspaceServerProtocol', 'Operation did not send a valid readiness frame'))); }
        },
      },
    })).pipe(Effect.matchEffect({
      onFailure: cause => Deferred.fail(worker.result, new ConcordError('OperationResultUnknown', 'Operation transport failed', { message: String(cause) })),
      onSuccess: result => Deferred.succeed(worker.result, result),
    }), Effect.ensuring(Effect.gen(function*() {
      yield* Deferred.fail(worker.ready, exited);
      yield* inspect(worker).pipe(Effect.orDie);
      if (idle === worker) idle = undefined;
      if (enabled) yield* Effect.forkIn(Effect.sleep('1 second').pipe(Effect.andThen(warm), Effect.ignore), scope);
    }))), scope);
    return worker;
  });
  const warm: Effect.Effect<void, ConcordError> = selection.withPermit(Effect.suspend(() => enabled && !idle && !unconfirmed ? start.pipe(Effect.map(worker => { idle = worker; })) : Effect.void));
  const pause = selection.withPermit(Effect.suspend(() => {
    enabled = false;
    const worker = idle; idle = undefined;
    return worker ? stopWorker(worker) : Effect.void;
  }));
  const close = pause.pipe(Effect.andThen(Effect.suspend(() => Effect.forEach([...workers], stopWorker, { discard: true }))), Effect.andThen(ensureClean));
  const drain = Effect.gen(function*() { while ([...workers].some(worker => worker.used)) yield* Effect.sleep('10 millis'); });
  const resume = Effect.gen(function*() {
    enabled = true;
    yield* warm;
    if (idle) yield* Deferred.await(idle.ready).pipe(Effect.timeout('60 seconds'));
  });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  const take = selection.withPermit(Effect.gen(function*() {
    if (!enabled) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'Operations are draining'));
    let worker = idle; idle = undefined;
    if (worker && Deferred.isDoneUnsafe(worker.result)) { yield* stopWorker(worker); worker = undefined; }
    worker ??= yield* start;
    worker.used = true;
    return worker;
  }));
  return { close, pause, resume, drain, ensureClean, run: (input: { readonly kind: 'action'; readonly input: unknown }) => Effect.gen(function*() {
    yield* ensureClean;
    const worker = yield* take.pipe(Effect.onError(() => warm.pipe(Effect.ignore)));
    return yield* Effect.gen(function*() {
    yield* Deferred.await(worker.ready).pipe(Effect.timeout('60 seconds'));
    const rows = yield* snapshot;
    const transport = yield* Deferred.await(worker.input);
    yield* Effect.sync(() => { transport.write(JSON.stringify({ root, cwd: execution.cwd, environment: execution.env, snapshot: rows, ...input })); transport.end(); });
    const result = yield* Deferred.await(worker.result);
    if (!OwnedProcess.confirmed(result)) { unconfirmed = true; return yield* ensureClean; }
    if (result.exitCode !== 0 || result.cancelled || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('OperationResultUnknown', 'Operation process ended without a confirmed receipt; inspect recovery state', { stderr: result.stderr.slice(-4096) }));
    const reply = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(OperationReply), { onExcessProperty: 'error' })(result.stdout.slice(worker.header.length)), catch: () => new ConcordError('OperationResultUnknown', 'Operation did not return a valid receipt; inspect recovery state') });
    if (!reply.ok) return yield* Effect.fail(new ConcordError(reply.code, reply.message, reply.details));
    yield* acceptDerived(reply.derived);
    return reply.value;
    }).pipe(Effect.ensuring(stopWorker(worker).pipe(Effect.orDie)), Effect.ensuring(warm.pipe(Effect.orDie)));
  }) };
});
import { connectWorkspaceSocket, requestWorkspace, submitFeedback } from './client.ts';

export function workspaceServerFailure(cause: unknown): ConcordError {
  if (cause instanceof ConcordError) return cause;
  const decoded = Schema.decodeUnknownExit(Schema.Struct({ code: Schema.optional(Schema.String), _tag: Schema.optional(Schema.String), message: Schema.String, details: Schema.optional(Schema.Unknown), reason: Schema.optional(Schema.String) }))(cause);
  if (decoded._tag === 'Failure') return new ConcordError('WorkspaceServerUnavailable', String(cause));
  const value = decoded.value;
  return new ConcordError(value.code ?? (value._tag === 'ServerLockUnavailable' ? 'ServerLockUnavailable' : 'WorkspaceServerUnavailable'), value.message, value.details ?? (value.reason ? { reason: value.reason } : undefined));
}
const asServerError = (cause: unknown) => {
  if (cause instanceof WorkspaceServerError) return cause;
  const error = workspaceServerFailure(cause), details = Schema.decodeUnknownExit(Schema.Json)(error.details);
  return new WorkspaceServerError({ code: error.code, message: error.message, ...(details._tag === 'Success' ? { details: details.value } : {}) });
};
export const computationLayer = Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
const serverBaselineCache: GitBaselineCache = {};
const compute = Effect.fn('workspace.compute')(function*(root: string, operation: Computation) {
  switch (operation.kind) {
    case 'cache-rebuild': return yield* computeCacheRebuild(root);
    case 'source-digest': return yield* workspaceSourceDigest(root);
    case 'query': return yield* executeQuery(root, operation.request, operation.cache);
    case 'scan': {
      const builtFrom = new Date(yield* Clock.currentTimeMillis).toISOString();
      const { snapshot, drift, sourceDigest } = yield* observeWorkspaceProjection(root);
      return yield* Effect.try({ try: () => makeWorkspaceProjectionCandidate(snapshot, drift, builtFrom, sourceDigest), catch: failure });
    }
    case 'read': return yield* getViewFile(root, operation.path);
    case 'read-bytes': return yield* getWorkspaceRead(root, operation.path);
    case 'git-status': return yield* getViewGitStatus(root, serverBaselineCache);
    case 'git-diff': return yield* getGitDiff(root, operation.path, operation.area);
    case 'p5-compile': return yield* compileP5(root, operation.input);
  }
});
export const runComputeMain = (root: string | undefined): void => {
  const program = Effect.scoped(Effect.gen(function*() {
  const execution = yield* RuntimeEnvironment;
  const parseCache = yield* Cache.parseOwner;
  let snapshot: typeof Snapshot.Type = {}, snapshotId: string | undefined;
  let pendingId: string | undefined, size = 0, chunks: Uint8Array[] = [];
  const handlers = ComputeRpcs.toLayer({
    snapshot: request => Effect.try({ try: () => {
      if (pendingId !== request.id) { chunks = []; size = 0; pendingId = request.id; }
      size += request.data.byteLength;
      if (size > 32 * FRAME_LIMIT) throw new WorkspaceServerError({ code: 'WorkspaceServerInputLimit', message: 'Snapshot exceeds 32 MiB' });
      chunks.push(request.data);
      if (request.last) {
        snapshot = Schema.decodeUnknownSync(Schema.fromJsonString(Snapshot), { onExcessProperty: 'error' })(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
        snapshotId = request.id; pendingId = undefined; chunks = []; size = 0;
      }
    }, catch: asServerError }),
    execute: request => Stream.unwrap(Effect.scoped(Effect.gen(function*() {
      const operation = yield* Schema.decodeUnknownEffect(Computation, { onExcessProperty: 'error' })(request.operation);
      if (request.snapshotId !== snapshotId) return yield* Effect.fail(new ConcordError('WorkspaceServerProtocol', 'Snapshot is incomplete'));
      if (root === undefined) return yield* Effect.fail(new ConcordError('InvalidInput', 'Missing compute root'));
      const derived = CacheDerivations.make();
      const requestRuntime = parseCache.bind(operation.kind === 'query' ? makeRuntimeEnvironment(operation.cwd, operation.environment) : execution, root);
      const requestContext = yield* Layer.build(computationLayer).pipe(Effect.provideService(RuntimeEnvironment, requestRuntime), Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(requestRuntime.env))));
      const context = Context.add(requestContext, RuntimeEnvironment, requestRuntime);
      const value = yield* compute(root, operation).pipe(Effect.provide(CacheSnapshot.layer(operation.kind === 'query' && operation.cache === 'off' ? {} : snapshot)), Effect.provideService(CacheDerivations, derived), Effect.provideService(QueryRefreshRequest, { request: () => Effect.void }), Effect.provideContext(context), Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(requestRuntime.env))));
      return operation.kind === 'read-bytes' ? packets(Schema.encodeUnknownSync(ReadCodec)(value), 64 * FRAME_LIMIT) : jsonPackets({ value, derived: yield* derived.batches });
    })).pipe(Effect.mapError(asServerError))),
  });
  const protocol = RpcServer.layerProtocolStdio.pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(NodeServices.layer));
  yield* RpcServer.make(ComputeRpcs, { concurrency: 1 }).pipe(Effect.provide(handlers), Effect.provide(protocol));
  }));
  NodeRuntime.runMain(program.pipe(Effect.provide(startupEnvironment())));
};

export const makeComputationOwner = Effect.fn('makeComputationOwner')(function*(root: string, acceptDerived: (rows: readonly CacheDerivationBatch[]) => Effect.Effect<void, unknown> = () => Effect.void, role: 'foreground' | 'background' = 'foreground', closing: (pid?: number) => Effect.Effect<void, unknown> = () => Effect.void) {
  const installation = yield* Installation;
  const execution = yield* RuntimeEnvironment;
  const mutex = yield* Semaphore.make(1);
  const closePermit = yield* Semaphore.make(1);
  const readCpu = yield* makeProcessGroupCpuReader();
  let active: { progress: { groupId: number; responses: number }; scope: Scope.Closeable; client: RpcClient.RpcClient<RpcGroupTypes.Rpcs<typeof ComputeRpcs>, RpcClientErrorTypes.RpcClientError>; owner: ReturnType<typeof makeOwnedProcessService>; snapshot?: { readonly text: string; readonly id: string } } | undefined;
  let starting: { scope: Scope.Closeable; owner: ReturnType<typeof makeOwnedProcessService> } | undefined;
  const close = closePermit.withPermit(Effect.uninterruptible(Effect.gen(function*() {
    const worker = active ?? starting;
    if (!worker) return;
    yield* closing(active?.progress.groupId || undefined);
    // Retire the OS process before awaiting RPC finalizers: a stalled peer must
    // not prevent TERM/KILL escalation or keep the persistent owner alive.
    yield* worker.owner.stop('SIGTERM');
    yield* Scope.close(worker.scope, Exit.void);
    const cleanup = yield* worker.owner.cleanupResults;
    if (cleanup.some(result => !OwnedProcess.confirmed(result))) return yield* Effect.fail(new ConcordError('CleanupFailed', 'Computation process group cleanup is unconfirmed'));
    active = undefined; starting = undefined;
  })));
  const start = Effect.gen(function*() {
    const scope = yield* Scope.make();
    const owner = makeOwnedProcessService({ environment: execution });
    starting = { scope, owner };
    const ready = yield* Deferred.make<(bytes: string | Uint8Array) => void, WorkspaceServerError>();
    const opened = yield* Deferred.make<void, WorkspaceServerError>();
    const output = yield* Queue.unbounded<Uint8Array, WorkspaceServerError>();
    const progress = { groupId: 0, responses: 0 };
    yield* Effect.forkIn(owner.run([process.execPath, ...installation.worker('compute-worker'), root, role], {
      cwd: execution.cwd, outputLimitBytes: 128 * 1024 * 1024,
      stream: { ready: (write, _end, identity) => { progress.groupId = identity.groupId ?? identity.pid ?? 0; Deferred.doneUnsafe(ready, Effect.succeed(write)); }, stdout: chunk => { progress.responses++; Queue.offerUnsafe(output, chunk); } },
    }).pipe(Effect.scoped, Effect.ensuring(Effect.gen(function*() {
      const error = new WorkspaceServerError({ code: 'WorkspaceComputeExited', message: 'Computation process exited' });
      yield* Deferred.fail(ready, error); yield* Queue.fail(output, error);
    })), Effect.ignore), scope);
    const socket = Socket.make({
      reader: Deferred.await(ready).pipe(Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: error }) })), Effect.as({
        pull: Queue.takeAll(output).pipe(Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: error }) }))),
        upgrade: () => Effect.fail(new Socket.SocketError({ reason: new Socket.SocketUpgradeError({ cause: 'Owned computation pipes do not support TLS' }) })),
      })),
      writer: Effect.succeed({
        write: chunk => Deferred.await(ready).pipe(Effect.flatMap(write => Effect.sync(() => { if (!(chunk instanceof Socket.CloseEvent)) write(chunk); })), Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause: error }) }))),
        writeAll: chunks => Deferred.await(ready).pipe(Effect.flatMap(write => Effect.sync(() => { for (const chunk of chunks) write(chunk); })), Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause: error }) }))),
      }),
    });
    const protocol = Layer.effect(RpcClient.Protocol, makeComputationProtocol(socket)).pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, { onConnect: Deferred.succeed(opened, undefined).pipe(Effect.asVoid), onDisconnect: Deferred.fail(opened, new WorkspaceServerError({ code: 'WorkspaceComputeExited', message: 'Computation transport closed' })).pipe(Effect.asVoid) })));
    const protocolContext = yield* Layer.build(protocol).pipe(Effect.provideService(Scope.Scope, scope));
    const client = yield* RpcClient.make(ComputeRpcs).pipe(Effect.provideContext(protocolContext), Effect.provideService(Scope.Scope, scope));
    yield* Deferred.await(opened).pipe(Effect.timeout('60 seconds'));
    active = { scope, owner, client, progress };
    starting = undefined;
    return active;
  });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return { close, open: mutex.withPermit(Effect.suspend(() => active ? Effect.void : start.pipe(Effect.asVoid))), run: (operation: Computation, snapshot: Parameters<typeof CacheSnapshot.layer>[0] = {}) => mutex.withPermit(Effect.gen(function*() {
    const worker = active ?? (yield* start);
    const acquired = channel('concord.workspace.computation');
    if (acquired.hasSubscribers) acquired.publish({ root, kind: operation.kind });
    const text = JSON.stringify(snapshot ?? {}), id = worker.snapshot?.text === text ? worker.snapshot.id : crypto.randomUUID();
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > 32 * FRAME_LIMIT) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Cache snapshot exceeds 32 MiB'));
    const chunkSize = FRAME_LIMIT - 4096;
    return yield* Effect.gen(function*() {
      if (worker.snapshot?.id !== id) {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) yield* worker.client.snapshot({ id, data: bytes.subarray(offset, offset + chunkSize), last: offset + chunkSize >= bytes.byteLength });
        worker.snapshot = { text, id };
      }
      const stream = worker.client.execute({ operation: JSON.parse(JSON.stringify(operation)), snapshotId: id });
      if (operation.kind === 'read-bytes') return yield* collectBytes(stream, 64 * FRAME_LIMIT).pipe(Effect.flatMap(bytes => Schema.decodeUnknownEffect(ReadCodec, { onExcessProperty: 'error' })(bytes)));
      const reply = yield* collectPackets(stream).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(ComputationReply, { onExcessProperty: 'error' })(value)));
      if (reply.derived.length > 0 && !(operation.kind === 'query' && operation.cache === 'off')) yield* acceptDerived(reply.derived);
      return reply.value;
    }).pipe(Effect.raceFirst(watchComputation(readCpu(worker.progress.groupId), () => worker.progress.responses)));
  }).pipe(Effect.mapError(cause => cause instanceof RpcClientError ? new ConcordError('WorkspaceComputeExited', 'Computation transport failed', { message: String(cause) }) : cause), Effect.onError(cause => {
    // A completed domain error leaves the RPC peer usable. Transport failures,
    // malformed replies, resource limits and cancellation retire its owner.
    const reusable = cause.reasons.length > 0 && cause.reasons.every(reason =>
      Cause.isFailReason(reason) && reason.error instanceof WorkspaceServerError &&
      !['WorkspaceServerProtocol', 'WorkspaceServerInputLimit', 'WorkspaceServerOutputLimit', 'WorkspaceComputeExited'].includes(reason.error.code));
    return reusable ? Effect.void : close.pipe(Effect.orDie);
  }))) };
});

const serverServices = Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const serveWorkspace = Effect.fn('serveWorkspace')(function*(input: string, ready: Effect.Effect<void> = Effect.void, commandScope?: typeof CommandScope.Type) {
  return yield* Effect.scoped(Effect.gen(function*() {
    yield* Layer.build(ProcessEventsLive);
    const execution = yield* RuntimeEnvironment;
    const stdio = yield* Stdio.Stdio;
    const logs = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    let pendingLogBytes = 0;
    const logFiber = yield* Effect.forkScoped(Stream.runForEach(Stream.fromQueue(logs), bytes => Stream.run(Stream.succeed(bytes), stdio.stderr({ endOnDone: false })).pipe(Effect.tap(() => Effect.sync(() => { pendingLogBytes -= bytes.byteLength; })))));
    yield* Effect.addFinalizer(() => Queue.end(logs).pipe(Effect.andThen(Fiber.join(logFiber)), Effect.orDie));
    const writeLog = (line: string) => {
      const bytes = Buffer.from(line);
      if (pendingLogBytes + bytes.byteLength > 64 * 1024) return false;
      pendingLogBytes += bytes.byteLength;
      return Queue.offerUnsafe(logs, bytes);
    };
    const workspace = yield* Workspace;
    const { root, privateDir } = yield* workspace.locate(input, true);
    if (commandScope && (commandScope.root !== root || commandScope.privateDir !== privateDir || !process.connected)) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeMismatch', 'Command service requires its matching root and live parent IPC'));
    const platform = yield* ServerRuntime;
    const installation = platform.installation();
    const runtime = yield* platform.acquire(root, privateDir);
    let shuttingDown = false;
    // Losing the record path must not prevent releasing the owned resources.
    const cleaning = (phase: Parameters<typeof runtime.cleaning>[0], pid?: number) => Effect.suspend(() => shuttingDown ? runtime.cleaning(phase, pid).pipe(Effect.ignore) : Effect.void);
    const admission = makeRequestAdmission();
    const socketServer = yield* NodeSocketServer.make({ path: runtime.socketPath });
    yield* runtime.publish('opening');
    const persistent = yield* PersistentCache;
    const cache = yield* PersistentCache.owner(privateDir);
    const runCache = async <A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> => {
      const outcome = await Effect.runPromise(Effect.result(operation), { signal });
      if (outcome._tag === 'Failure') throw outcome.failure;
      return outcome.success;
    };
    const searchOwner = makeKnowledgeSearchOwner({
      search: (input, signal) => runCache(cache.search(input), signal),
      discard: (kind, memory, signal) => runCache(cache.discardSearch(kind, memory), signal),
    });
    const sourceParsers = new ContentCacheOwner(false);
    yield* Effect.addFinalizer(() => Effect.sync(() => sourceParsers.close()));
    const searchQuery = (request: AppTypes.QueryRequest, mode: 'use' | 'off', environment: RuntimeEnvironmentSnapshot) => Effect.scoped(Effect.gen(function*() {
      const requestRuntime = sourceParsers.bind(environment, root);
      const services = Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Git.layer).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
      const context = yield* Layer.build(services).pipe(Effect.provideService(RuntimeEnvironment, requestRuntime));
      return yield* executeQuery(root, request, mode).pipe(Effect.provideContext(context), Effect.provideService(RuntimeEnvironment, requestRuntime), Effect.provideService(PersistentCache, persistent), Effect.provideService(KnowledgeSearch, searchOwner), Effect.provideService(QueryRefreshRequest, { request: () => Effect.void }));
    }));
    const snapshot = (background = false) => (background ? cache.backgroundSnapshot : cache.snapshot).pipe(Effect.catch(cause => {
      const error = workspaceServerFailure(cause);
      const code = Schema.decodeUnknownExit(CacheSnapshotUnavailable.fields.code)(error.code);
      return Effect.succeed<ReadonlyCacheSnapshot>({ unavailable: { code: code._tag === 'Success' ? code.value : 'HawdbUnavailable', message: error.message } });
    }));
    const cacheSnapshot = snapshot();
    const protocolReady = yield* Deferred.make<void>();
    const owned = <A, E, R>(operation: Effect.Effect<A, E, R | PersistentCache>, background = false) => operation.pipe(Effect.provideService(PersistentCache, background ? cache.backgroundService : cache.service));
    const context = workspaceProjectionContext(root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(RuntimeEnvironment, execution));
    const sources = yield* Sources;
    let watch: SourceWatch | undefined;
    const stateContext = yield* Layer.build(WorkspaceState.layer(runtime.token));
    const acceptDerived = (rows: readonly CacheDerivationBatch[], background = false) => cache.mergeDerived(rows, background).pipe(Effect.catch(cause => {
      const error = workspaceServerFailure(cause);
      return Context.get(stateContext, WorkspaceState).transition('degraded', { code: error.code, message: error.message });
    }));
    const operations = yield* makeOperationOwner(root, cacheSnapshot, acceptDerived);
    const computation = yield* makeComputationOwner(root, acceptDerived, 'foreground', pid => cleaning('foreground-computation', pid));
    const cachePermit = yield* Semaphore.make(1);
    const backgroundComputation = yield* makeComputationOwner(root, batches => cachePermit.withPermit(acceptDerived(batches, true)), 'background', pid => cleaning('background-computation', pid));
    const service = yield* makeWorkspaceService({
      verify: runtime.verify,
      health: cache.verify,
      context,
      sourceDigest: backgroundComputation.run({ kind: 'source-digest' }).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(Schema.String)(value)), Effect.mapError(failure)),
      ready: ctx => assertWorkspacePublicationReady(ctx).pipe(Effect.provideService(Sources, sources), Effect.provideService(RuntimeEnvironment, execution)),
      restore: ctx => owned(readWorkspaceProjection(ctx), true).pipe(Effect.map(value => ({ ...value, projection: { ...value.projection, refreshOwner: 'active' as const } })), Effect.provideService(RuntimeEnvironment, execution)),
      persist: (ctx, candidate, error, attempt) => owned(storeWorkspaceProjection(ctx, candidate, error, attempt), true).pipe(Effect.provideService(RuntimeEnvironment, execution)),
      compute: operation => (operation.kind === 'scan' ? cachePermit.withPermit(snapshot(true)) : cacheSnapshot).pipe(Effect.flatMap(snapshot => (operation.kind === 'scan' ? backgroundComputation : computation).run(operation, snapshot))),
      open: Deferred.await(protocolReady).pipe(Effect.andThen(operations.resume), Effect.andThen(cache.open), Effect.andThen(computation.open), Effect.andThen(backgroundComputation.open)),
      beforeClear: operations.pause.pipe(Effect.andThen(operations.drain), Effect.andThen(computation.close), Effect.andThen(backgroundComputation.close)),
      close: SubscriptionRef.get(Context.get(stateContext, WorkspaceState).value).pipe(Effect.flatMap(value => value.state === 'stopping'
        ? cleaning('operations').pipe(Effect.andThen(operations.close)) : operations.pause.pipe(Effect.andThen(operations.drain))), Effect.andThen(computation.close), Effect.andThen(backgroundComputation.close), Effect.andThen(cleaning('cache')), Effect.andThen(cache.close), Effect.ensuring(Effect.sync(() => searchOwner.invalidate())), Effect.andThen(cleaning('resources'))),
      clear: clearWorkspaceCache(root, () => runCache(cache.clear)).pipe(Effect.ensuring(Effect.sync(() => searchOwner.invalidate())), Effect.provideService(Workspace, workspace), Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive))), Effect.provideService(RuntimeEnvironment, execution)),
      foregroundPending: admission.pending,
      cachePermit,
      exists: Effect.sync(() => existsSync(root) && existsSync(privateDir)),
      reconcile: candidate => watch ? watch.reconcile(candidate.snapshot.project, candidate.snapshot.sources) : Effect.succeed(false),
    }).pipe(Effect.provideContext(stateContext));
    yield* Effect.forkScoped(cache.failed.pipe(Effect.andThen(service.stop)));
    if (commandScope) {
      const disconnected = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(Effect.sync(() => {
        const listener = () => { Deferred.doneUnsafe(disconnected, Effect.void); };
        process.once('disconnect', listener);
        if (!process.connected) listener();
        return listener;
      }), listener => Effect.sync(() => { process.off('disconnect', listener); }));
      yield* Effect.forkScoped(Deferred.await(disconnected).pipe(Effect.andThen(service.stop)));
    }
    const serverScope = yield* Effect.scope;
    const rebuildOwnedCache = service.maintain(Effect.gen(function*() {
      const value = yield* cacheSnapshot.pipe(Effect.flatMap(snapshot => computation.run({ kind: 'cache-rebuild' }, snapshot)));
      const status = yield* cache.status;
      return yield* Effect.try({ try: () => finishCacheRebuild(value, status), catch: failure });
    }));
    const event = SubscriptionRef.changes(service.state.value).pipe(Stream.buffer({ capacity: 1, strategy: 'sliding' }));
    const httpSubscriptions = yield* makeHttpSubscriptions(event, service.connect);
    const runOperation = async (input: Parameters<typeof operations.run>[0], signal?: AbortSignal) => {
      try { return await Effect.runPromise(admission.withSlot(service.operate(operations.run(input))).pipe(Effect.mapError(workspaceServerFailure)), { signal }); }
      finally {
        const clean = await Effect.runPromise(Effect.result(operations.ensureClean));
        if (clean._tag === 'Failure') { await Effect.runPromise(service.state.transition('blocked', { code: 'CleanupFailed', message: clean.failure.message })); throw clean.failure; }
      }
    };
    yield* Effect.addFinalizer(() => Effect.sync(() => closeGitBaselineCache(serverBaselineCache)));
    const run = <A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal) => Effect.runPromise(operation, { signal });
    const runAdmitted = <A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal) => Effect.runPromise(admission.withSlot(operation).pipe(Effect.mapError(workspaceServerFailure)), { signal });
    const readProjection = service.state.touch.pipe(Effect.andThen(service.current), Effect.flatMap(value => {
      if (value.workspace) return Effect.succeed(value.workspace);
      if (value.error?.code === 'RecoveryRequired') return Effect.fail(new ConcordError('RecoveryRequired', value.error.message));
      if (value.state === 'degraded' && value.error) return Effect.fail(new ConcordError('WorkspaceProjectionUnavailable', value.error.message, { reason: value.error.code }));
      return Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is building'));
    }));
    const hosted = yield* makeHttpLeases(runtime.token, (host, port, sse) => Effect.tryPromise({ try: () => {
      const ports: HostedViewPorts = {
        verify: () => run(runtime.verify.pipe(Effect.mapError(workspaceServerFailure), Effect.andThen(service.state.touch))),
        workspace: () => runAdmitted(readProjection),
        refresh: () => { Effect.runFork(service.request); },
        read: path => runAdmitted(service.execute({ kind: 'read', path })) as Promise<ModelTypes.ViewFile>,
        git: () => runAdmitted(service.execute({ kind: 'git-status' })),
        diff: (path, area) => runAdmitted(service.execute({ kind: 'git-diff', path, area })),
        compile: input => runAdmitted(service.execute({ kind: 'p5-compile', input: Schema.decodeUnknownSync(Schema.Json)(input) })),
        action: async (input, signal) => {
          const action = decodeViewAction(input);
          const maintenance: Effect.Effect<unknown, unknown> | undefined = action.action === 'cache.status' ? service.maintain(cache.status)
            : action.action === 'cache.rebuild' ? rebuildOwnedCache : undefined;
          const value = action.action === 'memory.search' || action.action === 'issue.search'
            ? (await runAdmitted(service.operate(searchQuery({ name: action.action, input: { query: action.query } }, 'use', execution)), signal)).value
            : action.action === 'cache.clear' && !action.dryRun ? await runAdmitted(service.clear, signal) : maintenance ? await runAdmitted(maintenance, signal) : await runOperation({ kind: 'action', input: action }, signal);
          await run(service.request); return value;
        },
        sse,
        subscribe: httpSubscriptions.subscribe,
      };
      return startHostedViewServer({ root, host, port }, ports, execution, writeLog);
    }, catch: failure }));
    yield* Effect.addFinalizer(() => cleaning('http').pipe(Effect.orDie));
    yield* Effect.forkScoped(Effect.repeat(hosted.tick.pipe(Effect.ignore), importServiceHeartbeat));
    const subscribers = new Set<number>();
    watch = yield* sources.watch(root, () => { Effect.runFork(service.invalidate); }, error => { Effect.runFork(service.state.transition('running', { code: error.code, message: error.message })); });
    yield* watch.reconcile(null);
    yield* sources.watchPrivateHead(privateDir, () => { Effect.runFork(service.invalidate); });
    let countedReady = false;
    yield* Effect.forkScoped(Stream.runForEach(SubscriptionRef.changes(service.state.value), event => runtime.publish(event.state).pipe(Effect.tap(() => Effect.sync(() => {
      if (!countedReady && (event.state === 'running' || event.state === 'degraded')) {
        countedReady = true;
        recordProcessEvent({ kind: 'service-ready', role: 'service', instance: String(process.pid) }, execution.env);
      }
    })), Effect.catch(() => service.stop))));
    const authorizeScope = (scope?: string) => commandScope && scope !== commandScope.key
      ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerScoped', message: 'This service belongs to another command scope' }))
      : !commandScope && scope !== undefined ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerScopeExpired', message: 'The command service has ended' })) : Effect.void;
    const authorize = (request: { token: string; installation: string; deadline: number; scope?: string }, subscription = false) => runtime.verify.pipe(Effect.andThen(authorizeScope(request.scope)), Effect.andThen(Effect.gen(function*() {
      if (request.token !== runtime.token) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Service identity differs' }));
      if (request.deadline < (yield* Clock.currentTimeMillis)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerDeadline', message: 'Request deadline has expired' }));
      const state = yield* SubscriptionRef.get(service.state.value);
      if (!subscription && !['running', 'degraded', 'draining'].includes(state.state)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerBusy', message: `Service is ${state.state}` }));
      yield* service.state.touch;
    })), Effect.mapError(asServerError));
    const output = makeOutputAdmission();
    const result = <A, E, R>(request: { token: string; installation: string; deadline: number; scope?: string }, operation: Effect.Effect<A, E, R>) => Stream.unwrap(authorize(request).pipe(Effect.andThen(operation), Effect.map(output.json), Effect.mapError(asServerError)));
    const feedback = new FeedbackSessions();
    const derivations = new DerivationSessions();
    const refreshing = new Map<string, { requeue: boolean }>();
    const refreshQuery: (query: AppTypes.Query, requestRuntime: RuntimeEnvironmentSnapshot) => Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> = (query, requestRuntime) => Effect.gen(function*() {
      const key = objectDigest({ query, cwd: requestRuntime.cwd, environment: requestRuntime.env });
      const running = refreshing.get(key);
      if (running) { running.requeue = true; return; }
      const pending = { requeue: false };
      refreshing.set(key, pending);
      // A scan owns a subprocess, not the foreground computation permit. Track
      // its lifetime so clear waits for publication and shutdown reaps it.
      const scan = service.operate(owned(refreshDiagnosticQuery(root, query, Date.now(), 120_000, runtime.verify.pipe(Effect.mapError(failure))), true)).pipe(
        Effect.provide(Workspace.layer), Effect.provideService(RuntimeEnvironment, requestRuntime),
        Effect.provideService(QueryRefreshRequest, { request: () => Effect.sync(() => { pending.requeue = true; }) }),
        Effect.scoped,
      );
      yield* Effect.forkIn(scan.pipe(Effect.ensuring(Effect.gen(function*() {
        refreshing.delete(key);
        if (pending.requeue) yield* refreshQuery(query, requestRuntime);
      })), Effect.ignore), serverScope);
    });
    const handlers = WorkspaceRpcs.toLayer({
      hello: request => authorizeScope(request.scope).pipe(Effect.andThen(SubscriptionRef.get(service.state.value)), Effect.map(value => ({ protocol: PROTOCOL, installation, token: runtime.token, state: value.state, sourceDigest: value.sourceDigest, ...(value.error ? { error: value.error } : {}) }))),
      shutdown: request => authorizeScope(request.scope).pipe(Effect.andThen(request.token !== runtime.token ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Invalid instance token' })) : Effect.forkIn(Effect.sleep('10 millis').pipe(Effect.andThen(service.stop)), serverScope).pipe(Effect.asVoid))),
      subscribe: (request, options) => Stream.unwrap(authorize(request, true).pipe(Effect.tap(() => Effect.sync(() => { subscribers.add(options.client.id); })), Effect.as(Stream.flatMap(workspaceEvents(event).pipe(Stream.takeUntil(value => value.state === 'stopping')), output.json)))),
      workspace: request => result(request, readProjection),
      refresh: request => result(request, service.request.pipe(Effect.as({ status: 'requested' }))),
      query: request => result(request, Effect.gen(function*() {
        if (Buffer.byteLength(JSON.stringify(request.environment)) > 256 * 1024) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Query environment exceeds 256 KiB'));
        const input = yield* Schema.decodeUnknownEffect(importedQueryRequest, { onExcessProperty: 'error' })({ name: request.name, input: request.input });
        if (input.name === 'memory.search' || input.name === 'issue.search') return yield* service.operate(searchQuery(input, request.cache, makeRuntimeEnvironment(request.cwd, request.environment)));
        return yield* service.execute({ kind: 'query', request: input, cwd: request.cwd, environment: request.environment, cache: request.cache }).pipe(Effect.ensuring(input.name === 'historical' && request.cache !== 'off' ? refreshQuery(input.input.query, makeRuntimeEnvironment(request.cwd, request.environment)) : Effect.void));
      })),
      read: request => Stream.unwrap(authorize(request).pipe(Effect.andThen(service.execute({ kind: 'read-bytes', path: request.path })), Effect.map(value => output.bytes(Schema.encodeUnknownSync(ReadCodec)(value), 64 * FRAME_LIMIT)), Effect.mapError(asServerError))),
      'git-status': request => result(request, service.execute({ kind: 'git-status' })),
      'git-diff': request => result(request, service.execute({ kind: 'git-diff', path: request.path, area: request.area })),
      http: (request, options) => result(request, commandScope ? Effect.fail(new ConcordError('WorkspaceServerScoped', 'Command services cannot open HTTP listeners')) : request.action === 'open' ? hosted.open(request.host, request.port, subscribers.has(options.client.id), options.client.id) : request.lease ? hosted.close(request.lease) : Effect.fail(new ConcordError('InvalidInput', 'HTTP close requires a lease'))),
      'cache-clear': request => result(request, service.clear),
      'cache-status': request => result(request, service.maintain(cache.status).pipe(Effect.map(status => ({ ...status, owner: 'service', pid: process.pid, installation })))),
      'cache-rebuild': request => result(request, rebuildOwnedCache),
      'cache-snapshot': request => result(request, service.maintain(cacheSnapshot)),
      'cache-derived': (request, options) => result(request, derivations.apply(options.client.id, request, batches => service.maintain(cache.mergeDerived(batches)))),
      'feedback-merge': (request, options) => result(request, feedback.apply(options.client.id, request, cache.mergeFeedback)),
    });
    const serialization = yield* Layer.build(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT }));
    const protocol = yield* makeAdmittedProtocol(socketServer, service.connect, id => { feedback.disconnect(id); derivations.disconnect(id); subscribers.delete(id); Effect.runFork(hosted.disconnect(id)); }, admission).pipe(Effect.provideContext(serialization));
    yield* Effect.forkScoped(RpcServer.make(WorkspaceRpcs, { concurrency: 256 }).pipe(Effect.provide(handlers), Effect.provideService(RpcServer.Protocol, protocol)));
    yield* Effect.addFinalizer(() => cleaning('rpc').pipe(Effect.orDie));
    // Also runs on SIGTERM: owned peers must be reaped before RPC scope cleanup
    // can wait on requests whose computation transport is no longer responsive.
    yield* Effect.addFinalizer(() => Effect.gen(function*() {
      shuttingDown = true;
      yield* cleaning('operations');
      yield* operations.close;
      yield* computation.close;
      yield* backgroundComputation.close;
    }).pipe(Effect.orDie));
    yield* ready;
    yield* Deferred.succeed(protocolReady, undefined);
    yield* service.stopped;
    shuttingDown = true;
    yield* cleaning('requests');
    yield* operations.pause;
    yield* Effect.all([service.drain, operations.drain, FiberSet.awaitEmpty(httpSubscriptions.fibers)], { concurrency: 'unbounded' }).pipe(Effect.timeout('3 seconds'), Effect.ignore);
    yield* operations.close;
  }));
});
import { QueryRequest as importedQueryRequest } from '../../app/index.ts';
export const serveWorkspaceFromEnvironment = Effect.fn('serveWorkspaceFromEnvironment')(function*(root: string) {
  const environment = (yield* RuntimeEnvironment).env;
  const scope = environment.CONCORD_SERVER_SCOPE === undefined ? undefined : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CommandScope), { onExcessProperty: 'error' })(environment.CONCORD_SERVER_SCOPE).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeMismatch', 'Invalid command service scope')));
  return yield* serveWorkspace(root, Effect.void, scope);
});
export const runWorkspaceMain = (root: string) => NodeRuntime.runMain(Cache.withParseCache(serveWorkspaceFromEnvironment(root).pipe(Effect.provide(serverServices)), false).pipe(Effect.provide(startupEnvironment()), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause))));

export const existingWorkspace = Effect.fn('existingWorkspace')(function*(root: string) {
  const platform = yield* ServerRuntime;
  const { privateDir } = yield* (yield* Workspace).locate(root, true);
  const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
  if (!record) return undefined;
  const connection = yield* connectWorkspaceSocket(record.socket.path, platform.installation(), record.token, undefined, true, (yield* RuntimeEnvironment).env);
  if (connection.hello.installation !== record.installation || connection.hello.protocol !== record.protocol) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Handshake differs from the running record'));
  return connection;
});
export const feedbackWriterLayer = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const execution = yield* RuntimeEnvironment;
  const runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root).pipe(Effect.provideService(RuntimeEnvironment, execution), Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.catch(() => Effect.succeed(undefined)));
    if (!connection) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    if (connection.hello.protocol !== PROTOCOL) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback owner has another protocol'));
    return yield* submitFeedback(connection, connectionId, items);
  })) });
}));
export const refreshLayer = Layer.merge(Workspace.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const runRefreshMain = <A, E>(operation: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Workspace | PersistentCache | RuntimeEnvironment>): void => {
  NodeRuntime.runMain(Cache.withParseCache(operation.pipe(Effect.provide(refreshLayer))).pipe(Effect.provide(startupEnvironment())));
};

export const readerLayer = Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Cache.layer, CacheSnapshot.layer()).pipe(Layer.provide(NodeServices.layer));
export const runReaderMain = <A, E>(operation: Effect.Effect<A, E, Installation | Workspace | Sources | Cache | CacheSnapshot | RuntimeEnvironment>, cwd?: string): void => {
  NodeRuntime.runMain(Cache.withParseCache(operation.pipe(Effect.provide(readerLayer))).pipe(Effect.provide(startupEnvironment(cwd))));
};

/** Computation entries don't call this writer composition root. */
export const writerLayer = Layer.mergeAll(Publication.layer.pipe(Layer.provide(PublicationValidationLive)), PersistentCache.layer).pipe(Layer.provideMerge(readerLayer));
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication | PersistentCache | Installation | Workspace | Sources | Cache | CacheSnapshot | PersistentCache | RuntimeEnvironment>): void => {
  NodeRuntime.runMain(Cache.withParseCache(operation.pipe(Effect.provide(writerLayer))).pipe(Effect.provide(startupEnvironment())));
};

/** Only real process entry adapters capture the host. */
function startupEnvironment(cwd = process.cwd()) {
  const runtime = makeRuntimeEnvironment(cwd, process.env);
  return Layer.merge(RuntimeEnvironment.layer(runtime), ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env)));
}
