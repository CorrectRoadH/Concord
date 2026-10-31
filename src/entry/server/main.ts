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
import { QueryReply, executeQuery, observeWorkspaceProjection, makeWorkspaceProjectionRecord, getViewFile, getViewGitStatus, getGitDiff, compileP5, workspaceProjectionContext, readWorkspaceProjection, storeWorkspaceProjection } from '../../app/index.js';
import { ConcordError, failure } from '../../model/index.js';
import { ComputeRpcs, collectPackets, type Computation } from './computation.js';
import { WorkspaceRpcs, WorkspaceServerError, FRAME_LIMIT, PROTOCOL, jsonPackets } from './protocol.js';
import { WorkspaceState } from './state.js';
import { makeWorkspaceService } from './service.js';
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
    const client = yield* RpcClient.make(ComputeRpcs).pipe(Effect.provide(protocol), Effect.provideService(Scope.Scope, scope));
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
export const serveWorkspace = Effect.fn('serveWorkspace')(function*(input: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const workspace = yield* Workspace;
    const { root, privateDir } = yield* workspace.identify(input, true, true);
    const platform = yield* ServerRuntime;
    const runtime = yield* platform.acquire(root, privateDir);
    const socketServer = yield* NodeSocketServer.make({ path: runtime.socketPath });
    yield* runtime.publish('opening');
    const cache = yield* PersistentCache.owner(privateDir);
    const computation = yield* makeComputationOwner(root);
    const owned = <A, E, R>(operation: Effect.Effect<A, E, R | PersistentCache>) => operation.pipe(Effect.provideService(PersistentCache, cache.service));
    const context = workspaceProjectionContext(root).pipe(Effect.provideService(Workspace, workspace));
    const sources = yield* Sources;
    const service = yield* makeWorkspaceService({
      verify: runtime.verify,
      context,
      ready: ctx => sources.pendingPublications(ctx.privateDir).pipe(Effect.flatMap(pending => pending.length > 0 ? Effect.fail(new ConcordError('RecoveryRequired', 'An interrupted publication exists; run concord recover')) : Effect.void)),
      restore: ctx => owned(readWorkspaceProjection(ctx)),
      persist: (ctx, candidate, error) => owned(storeWorkspaceProjection(ctx, candidate, error)),
      compute: operation => cache.snapshot.pipe(Effect.catch(() => Effect.succeed({})), Effect.flatMap(snapshot => computation.run(operation, snapshot))),
      open: cache.open,
      close: computation.close.pipe(Effect.andThen(cache.close)),
      clear: Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Cache maintenance is not connected')),
      exists: Effect.sync(() => existsSync(root) && existsSync(privateDir)),
    }).pipe(Effect.provide(WorkspaceState.layer(runtime.token)));
    const watch = yield* sources.watch(root, () => { Effect.runFork(service.invalidate); }, error => { Effect.runFork(service.state.transition('degraded', { code: error.code, message: error.message })); });
    yield* watch.reconcile(null);
    yield* Effect.forkScoped(Stream.runForEach(SubscriptionRef.changes(service.state.value), event => runtime.publish(event.state).pipe(Effect.catch(() => service.stop))));
    const authorize = (request: { token: string; installation: string; deadline: number }) => runtime.verify.pipe(Effect.andThen(Effect.gen(function*() {
      if (request.token !== runtime.token || request.installation !== platform.installation()) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Service identity differs' }));
      if (request.deadline < (yield* Clock.currentTimeMillis)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerDeadline', message: 'Request deadline has expired' }));
      const state = yield* SubscriptionRef.get(service.state.value);
      if (['blocked', 'stopping'].includes(state.state)) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerBusy', message: `Service is ${state.state}` }));
      yield* service.state.touch;
    })), Effect.mapError(asServerError));
    const result = <A, E, R>(request: { token: string; installation: string; deadline: number }, operation: Effect.Effect<A, E, R>) => Stream.unwrap(authorize(request).pipe(Effect.andThen(operation), Effect.map(jsonPackets), Effect.mapError(asServerError)));
    const handlers = WorkspaceRpcs.toLayer({
      hello: () => SubscriptionRef.get(service.state.value).pipe(Effect.map(value => ({ protocol: PROTOCOL, installation: platform.installation(), token: runtime.token, state: value.state, generation: value.generation }))),
      shutdown: request => request.token !== runtime.token ? Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Invalid instance token' })) : service.stop,
      subscribe: request => Stream.unwrap(authorize(request).pipe(Effect.as(Stream.flatMap(SubscriptionRef.changes(service.state.value), jsonPackets)))),
      workspace: request => result(request, SubscriptionRef.get(service.state.value).pipe(Effect.flatMap(value => value.workspace ? Effect.succeed(value.workspace) : Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is building'))))),
      refresh: request => result(request, service.request.pipe(Effect.as({ status: 'requested' }))),
      query: request => result(request, service.execute({ kind: 'query', request: Schema.decodeUnknownSync(importedQueryRequest, { onExcessProperty: 'error' })({ name: request.name, input: request.input }) })),
      read: request => result(request, service.execute({ kind: 'read', path: request.path })),
      'git-status': request => result(request, service.execute({ kind: 'git-status' })),
      'git-diff': request => result(request, service.execute({ kind: 'git-diff', path: request.path, area: request.area })),
      http: request => result(request, Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'HTTP hosting is not connected'))),
      'cache-clear': request => result(request, service.clear),
      'feedback-merge': request => result(request, Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback merge is not connected'))),
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
