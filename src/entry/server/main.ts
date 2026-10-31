import { Installation } from '../../base/installation/index.js';
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { Cache, CacheSnapshot, PersistentCache } from '../../base/cache/index.js';
import type { ChildProcessSpawner } from 'effect/unstable/process';
import { NodeSocketServer } from '@effect/platform-node';
import { Clock, Deferred, Exit, Fiber, Queue, Schema, Scope, Stream, SubscriptionRef } from 'effect';
import { RpcClient, RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { Socket, SocketServer } from 'effect/unstable/socket';
import { makeOwnedProcessService } from '../../app/index.js';
import { ServerRuntime } from '../../base/server-lock/index.js';
import { Git } from '../../base/git/index.js';
import { OwnedProcess, OwnedProcessLive } from '../../base/process/index.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Queries, QueryReply, executeQuery, observeWorkspaceProjection, makeWorkspaceProjectionRecord, getViewFile, getViewGitStatus, getGitDiff, compileP5, workspaceProjectionContext, readWorkspaceProjection, storeWorkspaceProjection } from '../../app/index.js';
import { ConcordError, failure } from '../../model/index.js';
import { ComputeRpcs, collectPackets, type Computation } from './computation.js';
import { WorkspaceRpcs, WorkspaceServerError, FRAME_LIMIT, PROTOCOL, jsonPackets } from './protocol.js';
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

const OperationRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('action'), root: Schema.String, input: ViewActionSchema, snapshot: Snapshot }),
  Schema.Struct({ kind: Schema.Literal('job'), root: Schema.String, caseId: Schema.String, snapshot: Snapshot }),
]);
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
    const layers = Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(request.snapshot), Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
    const operation = request.kind === 'action' ? executeViewAction(request.root, request.input) : runWorkspaceTest(request.root, request.caseId);
    return operation.pipe(Effect.provide(feedbackWriterLayer.pipe(Layer.provideMerge(layers))));
  }), Effect.match({ onSuccess: value => ({ ok: true, value }), onFailure: cause => { const error = failure(cause); return { ok: false, code: error.code, message: error.message, details: error.details }; } }), Effect.flatMap(reply => Effect.sync(() => { process.stdout.write(JSON.stringify(reply)); })));
  NodeRuntime.runMain(program);
};
const OperationReply = Schema.Union([Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json }), Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) })]);
const makeOperationOwner = Effect.fn('makeOperationOwner')(function*(root: string, snapshot: Effect.Effect<import('../../base/cache/index.js').ReadonlyCacheSnapshot, unknown>) {
  const installation = yield* Installation;
  const owners = new Set<ReturnType<typeof makeOwnedProcessService>>();
  const close = Effect.forEach(owners, owner => owner.awaitIdle.pipe(Effect.andThen(owner.cleanupResults), Effect.flatMap(results => results.some(result => result.processGroupOwned && result.groupCleanup.gone !== true) ? Effect.fail(new ConcordError('CleanupFailed', 'Operation process cleanup is unconfirmed')) : Effect.void)), { discard: true });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return { close, run: (input: { readonly kind: 'action'; readonly input: unknown } | { readonly kind: 'job'; readonly caseId: string }) => Effect.scoped(Effect.gen(function*() {
    const owner = makeOwnedProcessService(); owners.add(owner);
    const rows = yield* snapshot.pipe(Effect.catch(() => Effect.succeed({})));
    const result = yield* owner.run([process.execPath, ...installation.worker('operation-worker')], { cwd: installation.cwd, stdin: JSON.stringify({ root, snapshot: rows, ...input }), outputLimitBytes: 32 * FRAME_LIMIT });
    if (result.processGroupOwned && result.groupCleanup.gone !== true) return yield* Effect.fail(new ConcordError('CleanupFailed', 'Operation process cleanup is unconfirmed'));
    owners.delete(owner);
    if (result.exitCode !== 0 || result.cancelled || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('OperationResultUnknown', 'Operation process ended without a confirmed receipt; inspect recovery state', { stderr: result.stderr.slice(-4096) }));
    const reply = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(OperationReply), { onExcessProperty: 'error' })(result.stdout), catch: () => new ConcordError('OperationResultUnknown', 'Operation did not return a valid receipt; inspect recovery state') });
    if (!reply.ok) return yield* Effect.fail(new ConcordError(reply.code, reply.message, reply.details));
    return reply.value;
  })) };
});
import { connectWorkspaceSocket, requestWorkspace } from './client.js';

const asServerError = (cause: unknown) => cause instanceof WorkspaceServerError ? cause : new WorkspaceServerError({ code: cause instanceof ConcordError ? cause.code : 'WorkspaceServerUnavailable', message: cause instanceof Error ? cause.message : String(cause) });
const computationLayer = (snapshot: Parameters<typeof CacheSnapshot.layer>[0]) => Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(snapshot)).pipe(Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
const compute = Effect.fn('workspace.compute')(function*(root: string, operation: Computation) {
  switch (operation.kind) {
    case 'query': return yield* executeQuery(root, operation.request);
    case 'scan': {
      const builtFrom = new Date(yield* Clock.currentTimeMillis).toISOString();
      const { snapshot, drift } = yield* observeWorkspaceProjection(root);
      return yield* Effect.try({ try: () => makeWorkspaceProjectionRecord(snapshot, drift, builtFrom), catch: failure });
    }
    case 'read': return yield* getViewFile(root, operation.path);
    case 'git-status': return yield* getViewGitStatus(root);
    case 'git-diff': return yield* getGitDiff(root, operation.path, operation.area);
    case 'p5-compile': return yield* compileP5(root, operation.input);
  }
});
export const runComputeMain = (root: string | undefined): void => {
  const handlers = ComputeRpcs.toLayer({ execute: request => Stream.unwrap(
    (root === undefined ? Effect.fail(new ConcordError('InvalidInput', 'Missing compute root')) : compute(root, request.operation)).pipe(
      Effect.provide(computationLayer(request.snapshot)), Effect.map(jsonPackets), Effect.mapError(asServerError),
    ),
  ) });
  const protocol = RpcServer.layerProtocolStdio.pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(NodeServices.layer));
  NodeRuntime.runMain(RpcServer.make(ComputeRpcs, { concurrency: 1 }).pipe(Effect.provide(handlers), Effect.provide(protocol)));
};

const makeComputationOwner = Effect.fn('makeComputationOwner')(function*(root: string) {
  const installation = yield* Installation;
  let active: { scope: Scope.Closeable; client: RpcClient.RpcClient<import('effect/unstable/rpc/RpcGroup').Rpcs<typeof ComputeRpcs>, import('effect/unstable/rpc/RpcClientError').RpcClientError>; owner: ReturnType<typeof makeOwnedProcessService> } | undefined;
  const close = Effect.gen(function*() {
    const worker = active; active = undefined;
    if (!worker) return;
    yield* Scope.close(worker.scope, Exit.void);
    const cleanup = yield* worker.owner.cleanupResults;
    if (cleanup.some(result => result.processGroupOwned && result.groupCleanup.gone !== true)) return yield* Effect.fail(new ConcordError('CleanupFailed', 'Computation process group cleanup is unconfirmed'));
  });
  const start = Effect.gen(function*() {
    const scope = yield* Scope.make();
    const owner = makeOwnedProcessService();
    const ready = yield* Deferred.make<(bytes: string | Uint8Array) => void, WorkspaceServerError>();
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
    const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })), Layer.provide(Layer.succeed(Socket.Socket, socket)));
    const protocolContext = yield* Layer.build(protocol).pipe(Effect.provideService(Scope.Scope, scope));
    const client = yield* RpcClient.make(ComputeRpcs).pipe(Effect.provideContext(protocolContext), Effect.provideService(Scope.Scope, scope));
    active = { scope, owner, client };
    return active;
  });
  yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
  return { close, run: (operation: Computation, snapshot: Parameters<typeof CacheSnapshot.layer>[0]) => Effect.gen(function*() {
    const worker = active ?? (yield* start);
    return yield* collectPackets(worker.client.execute({ operation, snapshot: snapshot ?? {} })).pipe(Effect.timeout('60 seconds'), Effect.onError(() => close.pipe(Effect.orDie)));
  }) };
});

const serverServices = Layer.mergeAll(Installation.layer, ServerRuntime.layer, Workspace.layer, Sources.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const serveWorkspace = Effect.fn('serveWorkspace')(function*(input: string, ready: Effect.Effect<void> = Effect.void) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const workspace = yield* Workspace;
    const { root, privateDir } = yield* workspace.identify(input, true, true);
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
    const stateContext = yield* Layer.build(WorkspaceState.layer(runtime.token));
    const service = yield* makeWorkspaceService({
      verify: runtime.verify,
      context,
      ready: ctx => sources.pendingPublications(ctx.privateDir).pipe(Effect.flatMap(pending => pending.length > 0 ? Effect.fail(new ConcordError('RecoveryRequired', 'An interrupted publication exists; run concord recover')) : Effect.void)),
      restore: ctx => owned(readWorkspaceProjection(ctx)),
      persist: (ctx, candidate, error) => owned(storeWorkspaceProjection(ctx, candidate, error)),
      compute: operation => cache.snapshot.pipe(Effect.catch(() => Effect.succeed({})), Effect.flatMap(snapshot => computation.run(operation, snapshot))),
      open: cache.open,
      close: computation.close.pipe(Effect.andThen(cache.close)),
      clear: clearWorkspaceCache(root).pipe(Effect.provideService(Workspace, workspace), Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive)))),
      exists: Effect.sync(() => existsSync(root) && existsSync(privateDir)),
    }).pipe(Effect.provideContext(stateContext));
    const serverScope = yield* Effect.scope;
    const event = SubscriptionRef.changes(service.state.value);
    const notify = () => { Effect.runFork(SubscriptionRef.update(service.state.value, value => ({ ...value }))); };
    const jobs = new ServerJobs((caseId, signal) => Effect.runPromise(operations.run({ kind: 'job', caseId }), { signal }), () => { notify(); Effect.runFork(service.request); });
    yield* Effect.addFinalizer(() => Effect.tryPromise(() => jobs.close()).pipe(Effect.orDie));
    const run = <A, E>(operation: Effect.Effect<A, E>, signal?: AbortSignal) => Effect.runPromise(operation, { signal });
    const hosted = yield* makeHttpLeases(runtime.token, (host, port, sse) => Effect.tryPromise({ try: () => {
      const ports: HostedViewPorts = {
        workspace: () => run(SubscriptionRef.get(service.state.value).pipe(Effect.flatMap(value => value.workspace ? Effect.succeed(value.workspace) : Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is building'))))),
        refresh: () => { Effect.runFork(service.request); },
        read: path => run(service.execute({ kind: 'read', path })) as Promise<import('../../model/index.js').ViewFile>,
        git: () => run(service.execute({ kind: 'git-status' })),
        diff: (path, area) => run(service.execute({ kind: 'git-diff', path, area })),
        compile: input => run(service.execute({ kind: 'p5-compile', input: Schema.decodeUnknownSync(Schema.Json)(input) })),
        action: async (input, signal) => {
          const action = decodeViewAction(input);
          const value = await run(action.action === 'cache.clear' && !action.dryRun ? service.clear : operations.run({ kind: 'action', input: action }), signal);
          await run(service.request); return value;
        },
        jobs, sse,
        subscribe: listener => {
          const fiber = Effect.runFork(Stream.runForEach(event, value => Effect.sync(() => listener(value))));
          return () => { Effect.runFork(Fiber.interrupt(fiber)); };
        },
      };
      return startHostedViewServer({ root, host, port }, ports);
    }, catch: failure }));
    yield* Effect.forkScoped(Effect.repeat(hosted.tick.pipe(Effect.ignore), importServiceHeartbeat));
    const subscribers = new Set<number>();
    const watch = yield* sources.watch(root, () => { Effect.runFork(service.invalidate); }, error => { Effect.runFork(service.state.transition('degraded', { code: error.code, message: error.message })); });
    yield* watch.reconcile(null);
    yield* Effect.forkScoped(Stream.runForEach(SubscriptionRef.changes(service.state.value), event => runtime.publish(event.state).pipe(Effect.catch(() => service.stop))));
    const authorize = (request: { token: string; installation: string; deadline: number }) => runtime.verify.pipe(Effect.andThen(Effect.gen(function*() {
      if (request.token !== runtime.token || request.installation !== installation) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Service identity differs' }));
      if (request.deadline < (yield* Clock.currentTimeMillis)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerDeadline', message: 'Request deadline has expired' }));
      const state = yield* SubscriptionRef.get(service.state.value);
      if (['blocked', 'stopping'].includes(state.state)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerBusy', message: `Service is ${state.state}` }));
      yield* service.state.touch;
    })), Effect.mapError(asServerError));
    const result = <A, E, R>(request: { token: string; installation: string; deadline: number }, operation: Effect.Effect<A, E, R>) => Stream.unwrap(authorize(request).pipe(Effect.andThen(operation), Effect.map(jsonPackets), Effect.mapError(asServerError)));
    const feedback = new FeedbackSessions();
    const handlers = WorkspaceRpcs.toLayer({
      hello: () => SubscriptionRef.get(service.state.value).pipe(Effect.map(value => ({ protocol: PROTOCOL, installation, token: runtime.token, state: value.state, generation: value.generation }))),
      shutdown: request => request.token !== runtime.token ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Invalid instance token' })) : Effect.forkIn(Effect.sleep('10 millis').pipe(Effect.andThen(service.stop)), serverScope).pipe(Effect.asVoid),
      subscribe: (request, options) => Stream.unwrap(authorize(request).pipe(Effect.tap(() => Effect.sync(() => { subscribers.add(options.client.id); })), Effect.as(Stream.flatMap(SubscriptionRef.changes(service.state.value), jsonPackets)))),
      workspace: request => result(request, SubscriptionRef.get(service.state.value).pipe(Effect.flatMap(value => value.workspace ? Effect.succeed(value.workspace) : Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is building'))))),
      refresh: request => result(request, service.request.pipe(Effect.as({ status: 'requested' }))),
      query: request => result(request, service.execute({ kind: 'query', request: Schema.decodeUnknownSync(importedQueryRequest, { onExcessProperty: 'error' })({ name: request.name, input: request.input }) })),
      read: request => result(request, service.execute({ kind: 'read', path: request.path })),
      'git-status': request => result(request, service.execute({ kind: 'git-status' })),
      'git-diff': request => result(request, service.execute({ kind: 'git-diff', path: request.path, area: request.area })),
      http: (request, options) => result(request, request.action === 'open' ? hosted.open(request.host, request.port, subscribers.has(options.client.id)) : request.lease ? hosted.close(request.lease) : Effect.fail(new ConcordError('InvalidInput', 'HTTP close requires a lease'))),
      'cache-clear': request => result(request, service.clear),
      'feedback-merge': (request, options) => result(request, feedback.apply(options.client.id, request, cache.mergeFeedback)),
    });
    const sockets: SocketServer.SocketServer['Service'] = {
      ...socketServer,
      run: handler => socketServer.run(socket => Effect.scoped(service.connect.pipe(Effect.andThen(handler(socket))))),
    };
    const protocol = RpcServer.layerProtocolSocketServer.pipe(
      Layer.provide(Layer.succeed(SocketServer.SocketServer, sockets)),
      Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })),
    );
    yield* Effect.forkScoped(RpcServer.make(WorkspaceRpcs, { concurrency: 256 }).pipe(Effect.provide(handlers), Effect.provide(protocol)));
    yield* ready;
    yield* service.stopped;
  }));
});
import { QueryRequest as importedQueryRequest } from '../../app/index.js';
export const runWorkspaceMain = (root: string) => NodeRuntime.runMain(serveWorkspace(root).pipe(Effect.provide(serverServices), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause))));

export const existingWorkspace = Effect.fn('existingWorkspace')(function*(root: string) {
  const platform = yield* ServerRuntime;
  const { privateDir } = yield* (yield* Workspace).identify(root, true);
  const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
  if (!record) return undefined;
  return yield* connectWorkspaceSocket(record.socket.path, platform.installation(), record.token);
});
export const workspaceServerStatus = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.map(connection => connection ? { operation: 'server-status', ...connection.hello } : { operation: 'server-status', state: 'absent' }), Effect.catch(() => Effect.succeed({ operation: 'server-status', state: 'absent' }))));
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
  const installation = (yield* ServerRuntime).installation();
  if (current && current.hello.installation === installation && current.hello.protocol === PROTOCOL) return current;
  if (current) {
    yield* current.client.shutdown({ token: current.hello.token }).pipe(Effect.mapError(asServerError));
    const deadline = (yield* Clock.currentTimeMillis) + 3000;
    while ((yield* Clock.currentTimeMillis) < deadline) {
      const active = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
      if (!active) break;
      yield* Effect.sleep('20 millis');
    }
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
    yield* Effect.sync(() => ready({ root: options.root, ...lease }));
    if (inProcess) return yield* Fiber.join(inProcess);
    return yield* Effect.never;
  }));
}, Effect.mapError(failure));

export const refreshLayer = Layer.merge(Workspace.layer, PersistentCache.layer).pipe(Layer.provideMerge(NodeServices.layer));
export const runRefreshMain = <A, E>(operation: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner | Workspace | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(refreshLayer)));
};

export const readerLayer = Layer.mergeAll(PersistentCache.layer, Installation.layer, Workspace.layer, Sources.layer, Cache.layer, CacheSnapshot.layer()).pipe(Layer.provide(NodeServices.layer));
export const runReaderMain = <A, E>(operation: Effect.Effect<A, E, Installation | Workspace | Sources | Cache | CacheSnapshot>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(readerLayer)));
};

/** Computation entries don't call this writer composition root. */
export const writerLayer = Layer.mergeAll(Publication.layer.pipe(Layer.provide(PublicationValidationLive)), PersistentCache.layer).pipe(Layer.provideMerge(readerLayer));
export const runWriterMain = <A, E>(operation: Effect.Effect<A, E, Publication | PersistentCache | Installation | Workspace | Sources | Cache | CacheSnapshot | PersistentCache>): void => {
  NodeRuntime.runMain(operation.pipe(Effect.provide(writerLayer)));
};
