import { Installation } from '../../base/installation/index.js';
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";
import { Workspace } from '../../base/workspace/index.js';
import { Sources, type SourceWatch } from '../../base/sources/index.js';
import { Cache, CacheSnapshot, PersistentCache } from '../../base/cache/index.js';
import type { ChildProcessSpawner } from 'effect/unstable/process';
import { NodeSocketServer } from '@effect/platform-node';
import { Clock, Deferred, Exit, Fiber, Queue, Schema, Scope, Semaphore, Stream, SubscriptionRef } from 'effect';
import { RpcClient, RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { Socket, SocketServer } from 'effect/unstable/socket';
import { makeOwnedProcessService } from '../../app/index.js';
import { ServerRuntime } from '../../base/server-lock/index.js';
import { Git } from '../../base/git/index.js';
import { OwnedProcess, OwnedProcessLive } from '../../base/process/index.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Queries, QueryReply, executeQuery, observeWorkspaceProjection, makeWorkspaceProjectionRecord, getViewFile, getViewGitStatus, getGitDiff, compileP5, workspaceProjectionContext, readWorkspaceProjection, storeWorkspaceProjection } from '../../app/index.js';
import { ConcordError, failure, WorkspaceProjectionSchema } from '../../model/index.js';
import { Computation, ComputeRpcs, collectPackets, collectBytes } from './computation.js';
import { WorkspaceRpcs, WorkspaceServerError, FRAME_LIMIT, PROTOCOL, jsonPackets, ReadCodec, packets, makeOutputAdmission } from './protocol.js';
import { makeAdmittedProtocol } from './admission.js';
import { getWorkspaceRead } from '../../app/index.js';
import { QueryRefreshRequest, queryContext, storeQuery, scanQueryProcess } from '../../app/index.js';
import { decodeQueryScanMessage } from '../../model/index.js';
import { WorkspaceState, serviceHeartbeat as importServiceHeartbeat } from './state.js';
import { makeWorkspaceService } from './service.js';
import { FeedbackSessions } from './feedback-session.js';
import { ServerJobs } from './jobs.js';
import { makeHttpLeases } from './http-leases.js';
import { startHostedViewServer, type HostedViewPorts } from '../http/index.js';
import { FeedbackCacheWriter } from '../../base/cache/index.js';
import { mergeLocalFeedbackObservation } from '../../app/index.js';
import type { RemoteFeedback } from '../../model/index.js';
import { executeViewAction, runWorkspaceTest, clearWorkspaceCache, decodeViewAction } from '../../app/index.js';
import { ViewActionSchema } from '../../model/index.js';
import { Snapshot } from './computation.js';
import { assertWorkspacePublicationReady } from '../../app/index.js';

const OperationRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('action'), root: Schema.String, input: ViewActionSchema, snapshot: Snapshot }),
  Schema.Struct({ kind: Schema.Literal('job'), root: Schema.String, caseId: Schema.String, snapshot: Snapshot }),
]);
export const operationLayer = (snapshot: Parameters<typeof CacheSnapshot.layer>[0] = {}) => Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(snapshot), Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
export const runOperationMain = (): void => {
  const program = Effect.tryPromise({ try: async () => {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > 32 * FRAME_LIMIT) throw new ConcordError('WorkspaceServerInputLimit', 'Operation input exceeds 32 MiB');
      chunks.push(bytes);
    }
    return Schema.decodeUnknownSync(Schema.fromJsonString(OperationRequest), { onExcessProperty: 'error' })(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)));
  }, catch: failure }).pipe(Effect.flatMap(request => {
    const layers = operationLayer(request.snapshot);
    const operation = request.kind === 'action' ? executeViewAction(request.root, request.input) : runWorkspaceTest(request.root, request.caseId);
    return operation.pipe(Effect.provide(feedbackWriterLayer.pipe(Layer.provideMerge(layers))));
  }), Effect.match({ onSuccess: value => ({ ok: true, value }), onFailure: cause => { const error = failure(cause); return { ok: false, code: error.code, message: error.message, details: error.details }; } }), Effect.flatMap(reply => Effect.sync(() => { process.stdout.write(JSON.stringify(reply)); })));
  NodeRuntime.runMain(program);
};
const OperationReply = Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json }), Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) })]);
const makeOperationOwner = Effect.fn('makeOperationOwner')(function*(root: string, snapshot: Effect.Effect<import('../../base/cache/index.js').ReadonlyCacheSnapshot, unknown>) {
  const installation = yield* Installation;
  const owners = new Set<ReturnType<typeof makeOwnedProcessService>>();
  let unconfirmed = false;
  const ensureClean = Effect.suspend(() => unconfirmed ? Effect.fail(new ConcordError('CleanupFailed', 'Operation process cleanup is unconfirmed')) : Effect.void);
  const inspect = (owner: ReturnType<typeof makeOwnedProcessService>) => owner.cleanupResults.pipe(Effect.flatMap(results => {
    if (results.some(result => !OwnedProcess.confirmed(result))) { unconfirmed = true; return ensureClean; }
    owners.delete(owner); return Effect.void;
  }));
  const close = Effect.forEach(owners, owner => owner.awaitIdle.pipe(Effect.andThen(inspect(owner))), { discard: true }).pipe(Effect.andThen(ensureClean));
  const drain = Effect.gen(function*() { while (owners.size > 0) yield* Effect.sleep('10 millis'); });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return { close, drain, ensureClean, run: (input: { readonly kind: 'action'; readonly input: unknown } | { readonly kind: 'job'; readonly caseId: string }) => Effect.gen(function*() {
    yield* ensureClean;
    const owner = makeOwnedProcessService(); owners.add(owner);
    return yield* Effect.scoped(Effect.gen(function*() {
    const rows = yield* snapshot.pipe(Effect.catch(() => Effect.succeed({})));
    const result = yield* owner.run([process.execPath, ...installation.worker('operation-worker')], { cwd: installation.cwd, stdin: JSON.stringify({ root, snapshot: rows, ...input }), outputLimitBytes: 32 * FRAME_LIMIT });
    if (!OwnedProcess.confirmed(result)) { unconfirmed = true; return yield* ensureClean; }
    if (result.exitCode !== 0 || result.cancelled || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('OperationResultUnknown', 'Operation process ended without a confirmed receipt; inspect recovery state', { stderr: result.stderr.slice(-4096) }));
    const reply = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(OperationReply), { onExcessProperty: 'error' })(result.stdout), catch: () => new ConcordError('OperationResultUnknown', 'Operation did not return a valid receipt; inspect recovery state') });
    if (!reply.ok) return yield* Effect.fail(new ConcordError(reply.code, reply.message, reply.details));
    return reply.value;
    })).pipe(Effect.onExit(() => inspect(owner).pipe(Effect.orDie)));
  }) };
});
import { connectWorkspaceSocket, requestWorkspace } from './client.js';

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
const compute = Effect.fn('workspace.compute')(function*(root: string, operation: Computation) {
  switch (operation.kind) {
    case 'query': return yield* executeQuery(root, operation.request);
    case 'query-scan': return yield* scanQueryProcess(root, JSON.stringify(operation.query));
    case 'scan': {
      const builtFrom = new Date(yield* Clock.currentTimeMillis).toISOString();
      const { snapshot, drift } = yield* observeWorkspaceProjection(root);
      return yield* Effect.try({ try: () => makeWorkspaceProjectionRecord(snapshot, drift, builtFrom), catch: failure });
    }
    case 'read': return yield* getViewFile(root, operation.path);
    case 'read-bytes': return yield* getWorkspaceRead(root, operation.path);
    case 'git-status': return yield* getViewGitStatus(root);
    case 'git-diff': return yield* getGitDiff(root, operation.path, operation.area);
    case 'p5-compile': return yield* compileP5(root, operation.input);
  }
});
export const runComputeMain = (root: string | undefined): void => {
  const program = Effect.scoped(Effect.gen(function*() {
  const context = yield* Layer.build(computationLayer);
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
    execute: request => Stream.unwrap(Effect.gen(function*() {
      const operation = yield* Schema.decodeUnknownEffect(Computation, { onExcessProperty: 'error' })(request.operation);
      if (request.snapshotId !== snapshotId) return yield* Effect.fail(new ConcordError('WorkspaceServerProtocol', 'Snapshot is incomplete'));
      if (root === undefined) return yield* Effect.fail(new ConcordError('InvalidInput', 'Missing compute root'));
      const value = yield* compute(root, operation).pipe(Effect.provide(CacheSnapshot.layer(snapshot)), Effect.provideService(QueryRefreshRequest, { request: () => Effect.void }), Effect.provideContext(context));
      return operation.kind === 'read-bytes' ? packets(Schema.encodeUnknownSync(ReadCodec)(value), 64 * FRAME_LIMIT) : jsonPackets(value);
    }).pipe(Effect.mapError(asServerError))),
  });
  const protocol = RpcServer.layerProtocolStdio.pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(NodeServices.layer));
  yield* RpcServer.make(ComputeRpcs, { concurrency: 1 }).pipe(Effect.provide(handlers), Effect.provide(protocol));
  }));
  NodeRuntime.runMain(program);
};

export const makeComputationOwner = Effect.fn('makeComputationOwner')(function*(root: string) {
  const installation = yield* Installation;
  const mutex = yield* Semaphore.make(1);
  let active: { scope: Scope.Closeable; client: RpcClient.RpcClient<import('effect/unstable/rpc/RpcGroup').Rpcs<typeof ComputeRpcs>, import('effect/unstable/rpc/RpcClientError').RpcClientError>; owner: ReturnType<typeof makeOwnedProcessService> } | undefined;
  let starting: { scope: Scope.Closeable; owner: ReturnType<typeof makeOwnedProcessService> } | undefined;
  const close = Effect.gen(function*() {
    const worker = active ?? starting; active = undefined; starting = undefined;
    if (!worker) return;
    yield* Scope.close(worker.scope, Exit.void);
    const cleanup = yield* worker.owner.cleanupResults;
    if (cleanup.some(result => !OwnedProcess.confirmed(result))) return yield* Effect.fail(new ConcordError('CleanupFailed', 'Computation process group cleanup is unconfirmed'));
  });
  const start = Effect.gen(function*() {
    const scope = yield* Scope.make();
    const owner = makeOwnedProcessService();
    starting = { scope, owner };
    const ready = yield* Deferred.make<(bytes: string | Uint8Array) => void, WorkspaceServerError>();
    const opened = yield* Deferred.make<void, WorkspaceServerError>();
    const output = yield* Queue.unbounded<Uint8Array, WorkspaceServerError>();
    yield* Effect.forkIn(owner.run([process.execPath, ...installation.worker('compute-worker'), root], {
      cwd: installation.cwd, outputLimitBytes: 128 * 1024 * 1024,
      stream: { ready: write => { Deferred.doneUnsafe(ready, Effect.succeed(write)); }, stdout: chunk => { Queue.offerUnsafe(output, chunk); } },
    }).pipe(Effect.scoped, Effect.ensuring(Effect.gen(function*() {
      const error = new WorkspaceServerError({ code: 'WorkspaceComputeExited', message: 'Computation process exited' });
      yield* Deferred.fail(ready, error); yield* Queue.fail(output, error);
    })), Effect.ignore), scope);
    const socket = Socket.make({
      runRaw: (handler, options) => Deferred.await(ready).pipe(Effect.andThen(options?.onOpen ?? Effect.void), Effect.andThen(Stream.runForEach(Stream.fromQueue(output), chunk => handler(chunk) ?? Effect.void)), Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: error }) }))),
      writer: Effect.succeed(chunk => Deferred.await(ready).pipe(Effect.flatMap(write => Effect.sync(() => { if (!(chunk instanceof Socket.CloseEvent)) write(chunk); })), Effect.mapError(error => new Socket.SocketError({ reason: new Socket.SocketWriteError({ cause: error }) })))),
    });
    const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(Layer.succeed(Socket.Socket, socket)), Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, { onConnect: Deferred.succeed(opened, undefined).pipe(Effect.asVoid), onDisconnect: Deferred.fail(opened, new WorkspaceServerError({ code: 'WorkspaceComputeExited', message: 'Computation transport closed' })).pipe(Effect.asVoid) })));
    const protocolContext = yield* Layer.build(protocol).pipe(Effect.provideService(Scope.Scope, scope));
    const client = yield* RpcClient.make(ComputeRpcs).pipe(Effect.provideContext(protocolContext), Effect.provideService(Scope.Scope, scope));
    yield* Deferred.await(opened).pipe(Effect.timeout('60 seconds'));
    active = { scope, owner, client };
    starting = undefined;
    return active;
  });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return { close, run: (operation: Computation, snapshot: Parameters<typeof CacheSnapshot.layer>[0] = {}) => mutex.withPermit(Effect.gen(function*() {
    const worker = active ?? (yield* start);
    const id = crypto.randomUUID(), bytes = new TextEncoder().encode(JSON.stringify(snapshot ?? {}));
    if (bytes.byteLength > 32 * FRAME_LIMIT) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Cache snapshot exceeds 32 MiB'));
    const chunkSize = FRAME_LIMIT - 4096;
    return yield* Effect.gen(function*() {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) yield* worker.client.snapshot({ id, data: bytes.subarray(offset, offset + chunkSize), last: offset + chunkSize >= bytes.byteLength });
      const stream = worker.client.execute({ operation: JSON.parse(JSON.stringify(operation)), snapshotId: id });
      return yield* operation.kind === 'read-bytes' ? collectBytes(stream, 64 * FRAME_LIMIT).pipe(Effect.flatMap(bytes => Schema.decodeUnknownEffect(ReadCodec, { onExcessProperty: 'error' })(bytes))) : collectPackets(stream);
    });
  }).pipe(Effect.timeout('60 seconds'), Effect.onError(() => close.pipe(Effect.orDie)))) };
});

const serverServices = Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const serveWorkspace = Effect.fn('serveWorkspace')(function*(input: string, ready: Effect.Effect<void> = Effect.void) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const workspace = yield* Workspace;
    const { root, privateDir } = yield* workspace.locate(input, true);
    const platform = yield* ServerRuntime;
    const installation = platform.installation();
    const runtime = yield* platform.acquire(root, privateDir);
    const socketServer = yield* NodeSocketServer.make({ path: runtime.socketPath });
    yield* runtime.publish('opening');
    const cache = yield* PersistentCache.owner(privateDir);
    const operations = yield* makeOperationOwner(root, cache.snapshot);
    const computation = yield* makeComputationOwner(root);
    const owned = <A, E, R>(operation: Effect.Effect<A, E, R | PersistentCache>) => operation.pipe(Effect.provideService(PersistentCache, cache.service));
    const context = workspaceProjectionContext(root).pipe(Effect.provideService(Workspace, workspace));
    const sources = yield* Sources;
    let watch: SourceWatch | undefined;
    const stateContext = yield* Layer.build(WorkspaceState.layer(runtime.token));
    const service = yield* makeWorkspaceService({
      verify: runtime.verify,
      context,
      ready: ctx => assertWorkspacePublicationReady(ctx).pipe(Effect.provideService(Sources, sources)),
      restore: ctx => owned(readWorkspaceProjection(ctx)).pipe(Effect.map(value => ({ ...value, projection: { ...value.projection, refreshOwner: 'active' as const } }))),
      persist: (ctx, candidate, error) => owned(storeWorkspaceProjection(ctx, candidate, error)),
      compute: operation => cache.snapshot.pipe(Effect.catch(() => Effect.succeed({})), Effect.flatMap(snapshot => computation.run(operation, snapshot))),
      open: cache.open,
      close: computation.close.pipe(Effect.andThen(cache.close)),
      clear: clearWorkspaceCache(root).pipe(Effect.provideService(Workspace, workspace), Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive)))),
      exists: Effect.sync(() => existsSync(root) && existsSync(privateDir)),
      reconcile: candidate => watch ? watch.reconcile(candidate.snapshot.project, candidate.snapshot.sources) : Effect.succeed(false),
    }).pipe(Effect.provideContext(stateContext));
    const serverScope = yield* Effect.scope;
    const event = SubscriptionRef.changes(service.state.value).pipe(Stream.buffer({ capacity: 1, strategy: 'sliding' }));
    const httpSubscriptions = new Set<Fiber.Fiber<unknown, unknown>>();
    const notify = () => { Effect.runFork(SubscriptionRef.update(service.state.value, value => ({ ...value }))); };
    const runOperation = async (input: Parameters<typeof operations.run>[0], signal?: AbortSignal) => {
      try { return await Effect.runPromise(operations.run(input), { signal }); }
      finally {
        const clean = await Effect.runPromise(Effect.result(operations.ensureClean));
        if (clean._tag === 'Failure') { await Effect.runPromise(service.state.transition('blocked', { code: 'CleanupFailed', message: clean.failure.message })); throw clean.failure; }
      }
    };
    const jobs = new ServerJobs((caseId, signal) => runOperation({ kind: 'job', caseId }, signal), () => { notify(); Effect.runFork(service.request); });
    yield* Effect.addFinalizer(() => Effect.tryPromise(() => jobs.close()).pipe(Effect.orDie));
    const run = <A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal) => Effect.runPromise(operation, { signal });
    const readProjection = SubscriptionRef.get(service.state.value).pipe(Effect.flatMap(value => {
      if (value.workspace) return Effect.succeed(value.workspace);
      if (value.error?.code === 'RecoveryRequired') return Effect.fail(new ConcordError('RecoveryRequired', value.error.message));
      if (value.state === 'degraded' && value.error) return Effect.fail(new ConcordError('WorkspaceProjectionUnavailable', value.error.message, { reason: value.error.code }));
      return Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is building'));
    }));
    const hosted = yield* makeHttpLeases(runtime.token, (host, port, sse) => Effect.tryPromise({ try: () => {
      const ports: HostedViewPorts = {
        workspace: () => run(readProjection),
        refresh: () => { Effect.runFork(service.request); },
        read: path => run(service.execute({ kind: 'read', path })) as Promise<import('../../model/index.js').ViewFile>,
        git: () => run(service.execute({ kind: 'git-status' })),
        diff: (path, area) => run(service.execute({ kind: 'git-diff', path, area })),
        compile: input => run(service.execute({ kind: 'p5-compile', input: Schema.decodeUnknownSync(Schema.Json)(input) })),
        action: async (input, signal) => {
          const action = decodeViewAction(input);
          const value = action.action === 'cache.clear' && !action.dryRun ? await run(service.clear, signal) : await runOperation({ kind: 'action', input: action }, signal);
          await run(service.request); return value;
        },
        jobs, sse,
        subscribe: listener => {
          const fiber = Effect.runFork(Stream.runForEach(event.pipe(Stream.takeUntil(value => value.state === 'stopping')), value => Effect.promise(() => Promise.resolve(listener(value)))));
          httpSubscriptions.add(fiber);
          return () => { httpSubscriptions.delete(fiber); Effect.runFork(Fiber.interrupt(fiber)); };
        },
      };
      return startHostedViewServer({ root, host, port }, ports);
    }, catch: failure }));
    yield* Effect.forkScoped(Effect.repeat(hosted.tick.pipe(Effect.ignore), importServiceHeartbeat));
    const subscribers = new Set<number>();
    watch = yield* sources.watch(root, () => { Effect.runFork(service.invalidate); }, error => { Effect.runFork(service.state.transition('running', { code: error.code, message: error.message })); });
    yield* watch.reconcile(null);
    yield* sources.watchPrivateHead(privateDir, () => { Effect.runFork(service.invalidate); });
    yield* Effect.forkScoped(Stream.runForEach(SubscriptionRef.changes(service.state.value), event => runtime.publish(event.state).pipe(Effect.catch(() => service.stop))));
    const authorize = (request: { token: string; installation: string; deadline: number }, subscription = false) => runtime.verify.pipe(Effect.andThen(Effect.gen(function*() {
      if (request.token !== runtime.token || request.installation !== installation) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Service identity differs' }));
      if (request.deadline < (yield* Clock.currentTimeMillis)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerDeadline', message: 'Request deadline has expired' }));
      const state = yield* SubscriptionRef.get(service.state.value);
      if (!subscription && !['running', 'degraded', 'draining'].includes(state.state)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerBusy', message: `Service is ${state.state}` }));
      yield* service.state.touch;
    })), Effect.mapError(asServerError));
    const output = makeOutputAdmission();
    const result = <A, E, R>(request: { token: string; installation: string; deadline: number }, operation: Effect.Effect<A, E, R>) => Stream.unwrap(authorize(request).pipe(Effect.andThen(operation), Effect.map(output.json), Effect.mapError(asServerError)));
    const feedback = new FeedbackSessions();
    const refreshing = new Set<string>();
    const refreshQuery = (query: import('../../app/index.js').Query) => Effect.gen(function*() {
      const key = JSON.stringify(query);
      if (refreshing.has(key)) return;
      refreshing.add(key);
      yield* Effect.forkIn(Effect.gen(function*() {
        const ctx = yield* queryContext(root, query).pipe(Effect.provideService(Workspace, workspace));
        const message = yield* service.execute({ kind: 'query-scan', query });
        yield* runtime.verify;
        const decoded = decodeQueryScanMessage(message);
        yield* owned(storeQuery(ctx, decoded.ok ? { kind: 'candidate', message: decoded } : { kind: 'failure', error: { failedAt: new Date().toISOString(), scannedAt: decoded.scannedAt, code: decoded.code, message: decoded.message } }));
      }).pipe(Effect.ensuring(Effect.sync(() => { refreshing.delete(key); })), Effect.ignore), serverScope);
    });
    const handlers = WorkspaceRpcs.toLayer({
      hello: () => SubscriptionRef.get(service.state.value).pipe(Effect.map(value => ({ protocol: PROTOCOL, installation, token: runtime.token, state: value.state, generation: value.generation }))),
      shutdown: request => request.token !== runtime.token ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Invalid instance token' })) : Effect.forkIn(Effect.sleep('10 millis').pipe(Effect.andThen(service.stop)), serverScope).pipe(Effect.asVoid),
      subscribe: (request, options) => Stream.unwrap(authorize(request, true).pipe(Effect.tap(() => Effect.sync(() => { subscribers.add(options.client.id); })), Effect.as(Stream.flatMap(event.pipe(Stream.takeUntil(value => value.state === 'stopping')), output.json)))),
      workspace: request => result(request, readProjection),
      refresh: request => result(request, service.request.pipe(Effect.as({ status: 'requested' }))),
      query: request => result(request, Effect.gen(function*() {
        const input = yield* Schema.decodeUnknownEffect(importedQueryRequest, { onExcessProperty: 'error' })({ name: request.name, input: request.input });
        return yield* service.execute({ kind: 'query', request: input }).pipe(Effect.ensuring(input.name === 'historical' ? refreshQuery(input.input.query) : Effect.void));
      })),
      read: request => Stream.unwrap(authorize(request).pipe(Effect.andThen(service.execute({ kind: 'read-bytes', path: request.path })), Effect.map(value => output.bytes(Schema.encodeUnknownSync(ReadCodec)(value), 64 * FRAME_LIMIT)), Effect.mapError(asServerError))),
      'git-status': request => result(request, service.execute({ kind: 'git-status' })),
      'git-diff': request => result(request, service.execute({ kind: 'git-diff', path: request.path, area: request.area })),
      http: (request, options) => result(request, request.action === 'open' ? hosted.open(request.host, request.port, subscribers.has(options.client.id)) : request.lease ? hosted.close(request.lease) : Effect.fail(new ConcordError('InvalidInput', 'HTTP close requires a lease'))),
      'cache-clear': request => result(request, service.clear),
      'feedback-merge': (request, options) => result(request, feedback.apply(options.client.id, request, cache.mergeFeedback)),
    });
    const serialization = yield* Layer.build(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT }));
    const protocol = yield* makeAdmittedProtocol(socketServer, service.connect, id => { feedback.disconnect(id); subscribers.delete(id); }).pipe(Effect.provideContext(serialization));
    yield* Effect.forkScoped(RpcServer.make(WorkspaceRpcs, { concurrency: 256 }).pipe(Effect.provide(handlers), Effect.provideService(RpcServer.Protocol, protocol)));
    yield* ready;
    yield* service.stopped;
    yield* Effect.all([service.drain, operations.drain, ...[...httpSubscriptions].map(Fiber.await)], { concurrency: 'unbounded' }).pipe(Effect.timeout('3 seconds'), Effect.ignore);
    yield* operations.close;
  }));
});
import { QueryRequest as importedQueryRequest } from '../../app/index.js';
export const runWorkspaceMain = (root: string) => NodeRuntime.runMain(serveWorkspace(root).pipe(Effect.provide(serverServices), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause))));

export const existingWorkspace = Effect.fn('existingWorkspace')(function*(root: string) {
  const platform = yield* ServerRuntime;
  const { privateDir } = yield* (yield* Workspace).locate(root, true);
  const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
  if (!record) return undefined;
  const connection = yield* connectWorkspaceSocket(record.socket.path, platform.installation(), record.token);
  if (connection.hello.installation !== record.installation || connection.hello.protocol !== record.protocol) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Handshake differs from the running record'));
  return connection;
});
export const workspaceServerStatus = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.map(connection => connection ? { operation: 'server-status', ...connection.hello } : { operation: 'server-status', state: 'absent' }), Effect.catch(() => Effect.succeed({ operation: 'server-status', state: 'absent' }))));
export const readExistingWorkspaceProjection = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation() || connection.hello.protocol !== PROTOCOL) return undefined;
  return yield* requestWorkspace(connection, 'workspace', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(WorkspaceProjectionSchema, { onExcessProperty: 'error' })(value)), Effect.mapError(workspaceServerFailure));
}));
export const clearExistingWorkspaceCache = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation() || connection.hello.protocol !== PROTOCOL) return undefined;
  return yield* requestWorkspace(connection, 'cache-clear', {}).pipe(Effect.mapError(workspaceServerFailure));
}));
export const remoteQueriesLayer = Layer.unwrap(Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return Queries.Remote((root, request, cache = 'use') => Effect.scoped(Effect.gen(function*() {
    if (cache === 'off') return yield* executeQuery(root, request, cache);
    const identified = yield* workspace.identify(root, true);
    const remote = yield* Effect.result(existingWorkspace(identified.root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime)));
    if (remote._tag === 'Failure' || !remote.success || remote.success.hello.installation !== runtime.installation() || remote.success.hello.protocol !== PROTOCOL) return yield* executeQuery(root, request, cache);
    const reply = yield* Effect.result(requestWorkspace(remote.success, 'query', request));
    if (reply._tag === 'Failure') {
      const cause = reply.failure;
      if (cause instanceof WorkspaceServerError && !cause.code.startsWith('WorkspaceServer') && !cause.code.startsWith('WorkspaceCompute')) return yield* Effect.fail(new ConcordError(cause.code, cause.message, cause.details));
      return yield* executeQuery(root, request, cache);
    }
    return yield* Schema.decodeUnknownEffect(QueryReply, { onExcessProperty: 'error' })(reply.success).pipe(Effect.mapError(failure));
  })));
}));
export const feedbackWriterLayer = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.catch(() => Effect.succeed(undefined)));
    if (!connection) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    if (connection.hello.installation !== runtime.installation()) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback owner has another installation identity'));
    return yield* submitFeedback(connection, connectionId, items);
  })) });
}));
const submitFeedback = Effect.fn('submitFeedback')(function*(connection: import('./client.js').WorkspaceConnection, connectionId: string, items: readonly RemoteFeedback[]) {
  const session = crypto.randomUUID();
  yield* requestWorkspace(connection, 'feedback-merge', { action: 'begin', session, connectionId });
  let batch: RemoteFeedback[] = [], bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (size > FRAME_LIMIT - 8192) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'One feedback item exceeds a frame'));
    if (bytes + size > FRAME_LIMIT - 8192) {
      yield* requestWorkspace(connection, 'feedback-merge', { action: 'append', session, items: JSON.parse(JSON.stringify(batch)) });
      batch = []; bytes = 2;
    }
    batch.push(item); bytes += size;
  }
  if (batch.length > 0) yield* requestWorkspace(connection, 'feedback-merge', { action: 'append', session, items: JSON.parse(JSON.stringify(batch)) });
  const reply = yield* requestWorkspace(connection, 'feedback-merge', { action: 'commit', session });
  const decoded = yield* Schema.decodeUnknownEffect(Schema.Struct({ warnings: Schema.Array(Schema.String) }), { onExcessProperty: 'error' })(reply);
  return decoded.warnings;
});
export const connectOrStartWorkspace = Effect.fn('connectOrStartWorkspace')(function*(root: string) {
  let current = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  const platform = yield* ServerRuntime;
  const installation = platform.installation();
  if (current && current.hello.installation === installation && current.hello.protocol === PROTOCOL) return current;
  if (current) {
    const { privateDir } = yield* (yield* Workspace).locate(root, true);
    const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
    yield* current.client.shutdown({ token: current.hello.token }).pipe(Effect.mapError(asServerError));
    const deadline = (yield* Clock.currentTimeMillis) + 3000;
    let released = false;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      released = yield* platform.released(privateDir);
      if (released) break;
      yield* Effect.sleep('20 millis');
    }
    if (!released) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'The previous service has not released its native service lock', { pid: record?.pid, installation: current.hello.installation }));
    current = undefined;
  }
  yield* OwnedProcess.launch('workspace-server', [root], (yield* ServerRuntime).cwd);
  const deadline = (yield* Clock.currentTimeMillis) + 1000;
  do {
    current = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (current && current.hello.installation === installation && current.hello.protocol === PROTOCOL) return current;
    yield* Effect.sleep('10 millis');
  } while ((yield* Clock.currentTimeMillis) < deadline);
  return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'No workspace service completed a handshake within one second'));
});
export const startWorkspaceServer = (root: string) => Effect.scoped(connectOrStartWorkspace(root).pipe(Effect.map(connection => ({ operation: 'server-start', ...connection.hello }))));
export const stopWorkspaceServer = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.flatMap(connection => connection ? connection.client.shutdown({ token: connection.hello.token }) : Effect.void), Effect.as({ operation: 'server-stop' }), Effect.mapError(asServerError)));
const HttpLease = Schema.Struct({ host: Schema.String, port: Schema.Int, address: Schema.String, lease: Schema.String, token: Schema.String });
export const serveWorkspaceView = Effect.fn('serveWorkspaceView')(function*(options: { root: string; host: string; port: number; inProcess?: boolean }, ready: (server: { root: string; host: string; port: number; address: string }) => void) {
  return yield* Effect.scoped(Effect.gen(function*() {
    let inProcess: Fiber.Fiber<unknown, unknown> | undefined;
    if (options.inProcess) {
      const opened = yield* Deferred.make<void>();
      inProcess = yield* Effect.forkScoped(serveWorkspace(options.root, Deferred.succeed(opened, undefined).pipe(Effect.asVoid)));
      yield* Effect.raceFirst(Deferred.await(opened), Fiber.join(inProcess));
    }
    const connection = options.inProcess ? yield* existingWorkspace(options.root) : yield* connectOrStartWorkspace(options.root);
    if (!connection) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'The in-process workspace service did not open its socket'));
    const input = yield* requestWorkspace(connection, 'http', { action: 'open', host: options.host, port: options.port });
    const lease = yield* Schema.decodeUnknownEffect(HttpLease, { onExcessProperty: 'error' })(input);
    yield* Effect.addFinalizer(() => requestWorkspace(connection, 'http', { action: 'close', host: lease.host, port: lease.port, lease: lease.lease }).pipe(Effect.ignore));
    yield* Effect.sync(() => ready({ root: options.root, host: lease.host, port: lease.port, address: lease.address }));
    if (inProcess) return yield* Fiber.join(inProcess);
    return yield* Effect.never;
  }));
}, Effect.mapError(workspaceServerFailure));

export const refreshLayer = Layer.merge(Workspace.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const runRefreshMain = <A, E>(operation: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Workspace | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(refreshLayer)));
};

export const readerLayer = Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Cache.layer, CacheSnapshot.layer()).pipe(Layer.provide(NodeServices.layer));
export const runReaderMain = <A, E>(operation: Effect.Effect<A, E, Installation | Workspace | Sources | Cache | CacheSnapshot>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(readerLayer)));
};

/** Computation entries don't call this writer composition root. */
export const writerLayer = Layer.mergeAll(Publication.layer.pipe(Layer.provide(PublicationValidationLive)), PersistentCache.layer).pipe(Layer.provideMerge(readerLayer));
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication | PersistentCache | Installation | Workspace | Sources | Cache | CacheSnapshot | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(writerLayer)));
};
