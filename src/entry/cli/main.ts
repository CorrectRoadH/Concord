// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
import { Installation } from '../../base/installation/index.ts';
import { LspLauncher, ViewLauncher, ServerLauncher, QueryServerMode } from "./launchers.ts";
import { Publication } from "../../base/publication/index.ts";
import type { Queries } from "../../app/index.ts";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Context, Effect, Fiber, Layer, Schema } from "effect";
import type { Command } from "effect/unstable/cli";
import { ConcordError, failure, WorkspaceProjectionSchema } from "../../model/index.ts";
import { humanOutput } from "./presentation.ts";
import { OwnedProcess, OwnedProcessLive } from "../../base/process/index.ts";
import { Git } from '../../base/git/index.ts';
import { Workspace } from '../../base/workspace/index.ts';
import { Sources } from '../../base/sources/index.ts';
import { Cache, CacheSnapshot, CacheDerivations, PersistentCache, FeedbackCacheWriter } from '../../base/cache/index.ts';
import { ServerRuntime } from '../../base/server-lock/index.ts';
const loadClient = () => Effect.tryPromise(() => import('../server/index.ts')).pipe(Effect.mapError(failure));
const requestWorkspace: typeof import('../server/index.ts').requestWorkspace = (...args) => loadClient().pipe(Effect.flatMap(client => client.requestWorkspace(...args)));
const ServerFailure = Schema.Struct({ _tag: Schema.Literal('WorkspaceServerError'), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) });
const remoteFailure = (cause: unknown): ConcordError | undefined => {
  const decoded = Schema.decodeUnknownExit(ServerFailure, { onExcessProperty: 'ignore' })(cause);
  return decoded._tag === 'Success' ? new ConcordError(decoded.value.code, decoded.value.message, decoded.value.details) : undefined;
};
const workspaceServerFailure = (cause: unknown): ConcordError => remoteFailure(cause) ?? failure(cause);
const asServerError = workspaceServerFailure;
const installationIdentity = (runtime: ServerRuntime['Service']) => Effect.try({ try: () => runtime.installation(), catch: failure });
const nativeAvailable = Effect.flatMap(PersistentCache, cache => cache.verifyArtifact).pipe(
  Effect.mapError(cause => new ConcordError('HawdbUnavailable', cause.message)),
);

const loadServerMain = () => Effect.tryPromise(() => import('../server/main.ts'));
const loadApp = () => Effect.tryPromise(() => import('../../app/index.ts'));
const executeQuery: typeof import('../../app/index.ts').executeQuery = (...args) => loadApp().pipe(Effect.flatMap(app => app.executeQuery(...args)), Effect.mapError(failure));
const mergeLocalFeedbackObservation: typeof import('../../app/index.ts').mergeLocalFeedbackObservation = (...args) => loadApp().pipe(Effect.flatMap(app => app.mergeLocalFeedbackObservation(...args)), Effect.mapError(failure));
const builtAssetRoot = (name: 'web') => loadApp().pipe(Effect.flatMap(app => Effect.try({ try: () => app.builtAssetRoot(name), catch: failure })), Effect.mapError(failure));
const existingWorkspace = /*#__PURE__*/ Effect.fn('existingWorkspace')(function*(root: string, installation?: string, identifiedPrivateDir?: string, scope?: string) {
  const platform = yield* ServerRuntime;
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
  if (!record) return undefined;
  const { connectWorkspaceSocket } = yield* loadClient();
  const connection = yield* connectWorkspaceSocket(record.socket.path, installation ?? (yield* installationIdentity(platform)), record.token, scope);
  if (connection.hello.installation !== record.installation || connection.hello.protocol !== record.protocol) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Handshake differs from the running record'));
  return connection;
});
const workspaceServerStatus = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.map(connection => connection ? { operation: 'server-status', ...connection.hello } : { operation: 'server-status', state: 'absent' }), Effect.catch(() => Effect.succeed({ operation: 'server-status', state: 'absent' }))));
const readExistingWorkspaceProjection = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation()) return undefined;
  if (connection.hello.protocol !== (yield* loadClient()).PROTOCOL) return undefined;
  if (connection.hello.state === 'opening') return yield* Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is opening'));
  return yield* requestWorkspace(connection, 'workspace', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(WorkspaceProjectionSchema, { onExcessProperty: 'error' })(value)), Effect.mapError(workspaceServerFailure));
}));
const clearExistingWorkspaceCache = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation()) return undefined;
  if (connection.hello.protocol !== (yield* loadClient()).PROTOCOL) return undefined;
  return yield* requestWorkspace(connection, 'cache-clear', {}).pipe(Effect.mapError(workspaceServerFailure));
}));
const connectOrStartWorkspace = /*#__PURE__*/ Effect.fn('connectOrStartWorkspace')(function*(root: string, foreground = false, identifiedPrivateDir?: string, capturedInstallation?: string, artifactVerified = false) {
  if (!artifactVerified) yield* nativeAvailable;
  const { PROTOCOL, waitForServerHandshake } = yield* loadClient();
  const platform = yield* ServerRuntime;
  const installation = capturedInstallation ?? (yield* installationIdentity(platform));
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  yield* assertCompatibleWorkspaceRecord(privateDir, installation);
  const current = yield* existingWorkspace(root, installation, identifiedPrivateDir).pipe(Effect.catch(cause => {
    const error = workspaceServerFailure(cause);
    return error.code.startsWith('WorkspaceServerScope') || error.code === 'WorkspaceServerVersionConflict' ? Effect.fail(error) : Effect.succeed(undefined);
  }));
  if (current && current.hello.installation === installation && current.hello.protocol === PROTOCOL) return current;
  if (current) {
    return yield* Effect.fail(new ConcordError('WorkspaceServerVersionConflict', 'The running service uses another installation or protocol; stop it explicitly before starting this version'));
  }
  if (foreground) {
    const owner = yield* OwnedProcess, installed = yield* Installation;
    yield* Effect.forkScoped(Effect.scoped(owner.run([process.execPath, ...installed.worker('workspace-server'), root], { cwd: installed.cwd, stream: { ready: () => {}, stdout: () => {}, stderr: chunk => { process.stderr.write(chunk); } } })));
  } else yield* OwnedProcess.launch('workspace-server', [root], (yield* ServerRuntime).cwd);
  const connection = yield* waitForServerHandshake(existingWorkspace(root, installation));
  if (connection.hello.installation !== installation || connection.hello.protocol !== PROTOCOL) return yield* Effect.fail(new ConcordError('WorkspaceServerVersionConflict', 'The running service uses another installation or protocol'));
  return connection;
});

const assertCompatibleWorkspaceRecord = Effect.fn('assertCompatibleWorkspaceRecord')(function*(privateDir: string, installation?: string) {
  const runtime = yield* ServerRuntime, client = yield* loadClient();
  const record = yield* Effect.try({ try: () => runtime.read(privateDir, false), catch: failure });
  if (!record) return false;
  if (record.installation === (installation ?? (yield* installationIdentity(runtime))) && record.protocol === client.PROTOCOL) {
    const sourceDigest = yield* Effect.try({ try: runtime.sourceDigest, catch: failure });
    if (sourceDigest !== undefined && record.sourceDigest !== sourceDigest && !(yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure)))) {
      yield* Effect.scoped(Effect.gen(function*() {
        const connection = yield* client.connectWorkspaceSocket(record.socket.path, record.installation, record.token).pipe(Effect.mapError(workspaceServerFailure));
        yield* connection.client.shutdown({ token: record.token }).pipe(Effect.mapError(workspaceServerFailure));
      }));
      yield* waitForWorkspaceStop(runtime, privateDir, record.token).pipe(Effect.mapError(workspaceServerFailure));
      return false;
    }
    return true;
  }
  if (yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure))) return false;
  return yield* Effect.fail(new ConcordError('WorkspaceServerVersionConflict', 'The running service uses another installation or protocol; stop it with its matching installation'));
});

const connectQueryWorkspace = Effect.fn('connectQueryWorkspace')(function*(root: string, privateDir: string) {
  const client = yield* loadClient();
  const runtime = yield* ServerRuntime;
  const installation = yield* installationIdentity(runtime);
  const inherited = process.env.CONCORD_SERVER_SCOPE;
  if (inherited !== undefined) {
    const scope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(client.CommandScope), { onExcessProperty: 'error' })(inherited).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeMismatch', 'Invalid inherited command scope')));
    if (scope.root !== root || scope.privateDir !== privateDir) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeMismatch', 'Inherited command scope belongs to another project'));
    yield* assertCompatibleWorkspaceRecord(privateDir, installation);
    const connection = yield* existingWorkspace(root, installation, privateDir, scope.key).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service is unavailable')));
    if (!connection) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service has ended'));
    if (connection.hello.installation !== installation || connection.hello.protocol !== client.PROTOCOL) return yield* Effect.fail(new ConcordError('WorkspaceServerVersionConflict', 'The inherited service uses another installation or protocol'));
    return connection;
  }
  // Query selection has already verified the same installation for fallback.
  if ((yield* QueryServerMode) === 'shared') return yield* connectOrStartWorkspace(root, false, privateDir, installation, true);
  const record = yield* Effect.try({ try: () => runtime.read(privateDir, false), catch: failure });
  if (record && !(yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure)))) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'A service already owns this project; command mode cannot attach to it'));
  const current = yield* existingWorkspace(root, installation, privateDir).pipe(Effect.catch(cause => {
    const error = workspaceServerFailure(cause);
    return error.code.startsWith('WorkspaceServerScope') ? Effect.fail(new ConcordError('WorkspaceServerBusy', 'A command service already owns this project')) : Effect.succeed(undefined);
  }));
  if (current) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'A service already owns this project; command mode cannot attach to it'));
  const scope = { root, privateDir, key: crypto.randomUUID() };
  const owner = (yield* loadApp()).makeOwnedProcessService({ graceMs: 5000 });
  const installed = yield* Installation;
  yield* Effect.addFinalizer(() => owner.cleanupResults.pipe(Effect.flatMap(results => results.some(result => !OwnedProcess.confirmed(result))
    ? Effect.die(new ConcordError('CleanupFailed', 'Command service process group cleanup is unconfirmed')) : Effect.void)));
  const fiber = yield* Effect.forkScoped(Effect.scoped(owner.run([process.execPath, ...installed.worker('workspace-server'), root], {
    cwd: installed.cwd, env: { ...process.env, CONCORD_SERVER_SCOPE: JSON.stringify(scope) },
    ipc: { ready: () => {}, message: () => {} },
  })));
  const connection = yield* client.waitForServerHandshake(existingWorkspace(root, installation, privateDir, scope.key)).pipe(
    Effect.raceFirst(Fiber.join(fiber).pipe(Effect.flatMap(() => Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Command service exited before completing startup'))))),
  );
  yield* Effect.addFinalizer(() => connection.client.shutdown({ token: connection.hello.token, scope: scope.key }).pipe(
    Effect.ignore, Effect.andThen(Fiber.join(fiber).pipe(Effect.timeout('3 seconds'), Effect.catch(() => Fiber.interrupt(fiber)))), Effect.asVoid,
  ));
  return connection;
});

const awaitQueryReady = Effect.fn('awaitQueryReady')(function*(connection: import('../server/index.ts').WorkspaceConnection) {
  let hello = connection.hello;
  while (hello.state === 'opening') {
    yield* Effect.sleep('10 millis');
    hello = yield* connection.client.hello({ protocol: (yield* loadClient()).PROTOCOL, installation: connection.identity().installation, scope: connection.identity().scope });
  }
}, Effect.timeout('60 seconds'));

const existingCompatibleWorkspace = Effect.fn('existingCompatibleWorkspace')(function*(root: string, privateDir: string) {
  const client = yield* loadClient(), runtime = yield* ServerRuntime;
  let key: string | undefined;
  if (process.env.CONCORD_SERVER_SCOPE !== undefined) {
    const scope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(client.CommandScope), { onExcessProperty: 'error' })(process.env.CONCORD_SERVER_SCOPE).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeMismatch', 'Invalid inherited command scope')));
    if (scope.root !== root || scope.privateDir !== privateDir) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeMismatch', 'Inherited command scope belongs to another project'));
    key = scope.key;
  }
  const active = yield* assertCompatibleWorkspaceRecord(privateDir);
  const connection = active ? yield* existingWorkspace(root, runtime.installation(), privateDir, key).pipe(Effect.catch(cause => Effect.gen(function*() {
    if (yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure))) return undefined;
    return yield* Effect.fail(workspaceServerFailure(cause));
  }))) : undefined;
  if (!connection && key !== undefined) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service has ended'));
  if (connection && (connection.hello.installation !== runtime.installation() || connection.hello.protocol !== client.PROTOCOL)) return yield* Effect.fail(new ConcordError('WorkspaceServerVersionConflict', 'The running service uses another installation or protocol'));
  if (connection) yield* awaitQueryReady(connection).pipe(Effect.mapError(workspaceServerFailure));
  return connection;
});

function withWorkspaceCache<A, E, R>(workspace: Workspace['Service'], runtime: ServerRuntime['Service'], local: PersistentCache['Service'], root: string | undefined, operation: Effect.Effect<A, E, R>, required: boolean): Effect.Effect<A, E | ConcordError, R> {
  return Effect.scoped(Effect.gen(function*() {
    // A damaged source installation cannot authenticate a remote owner. The
    // repository cache reports the same unavailable diagnostic on the local path.
    if ((yield* Effect.result(local.verifyArtifact))._tag === 'Failure') return yield* operation;
    const identified = yield* workspace.locate(root);
    const connection = yield* existingCompatibleWorkspace(identified.root, identified.privateDir).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime));
    if (!connection) return yield* operation;
    const client = yield* loadClient();
    const snapshot = yield* requestWorkspace(connection, 'cache-snapshot', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(client.Snapshot, { onExcessProperty: 'error' })(value)), Effect.mapError(workspaceServerFailure));
    const derived = CacheDerivations.make();
    const cache = Context.get(yield* Layer.build(CacheSnapshot.layer(snapshot)), CacheSnapshot);
    const result = yield* operation.pipe(Effect.provideService(PersistentCache, {
      ...local,
      attach: repo => repo.privateDir === identified.privateDir ? cache.attach(repo).pipe(Effect.provideService(CacheDerivations, derived)) : local.attach(repo),
    }));
    yield* client.submitDerivations(connection, derived.batches()).pipe(Effect.mapError(workspaceServerFailure), Effect.catch(error => required ? Effect.fail(error) : Effect.sync(() => {
      process.stderr.write(`${JSON.stringify({ warning: 'CacheUpdateFailed', message: 'The operation completed, but its disposable cache update failed', reason: error.code })}\n`);
    })));
    return result;
  }));
}
const startWorkspaceServer = (root: string) => Effect.scoped(connectOrStartWorkspace(root).pipe(Effect.map(connection => ({ operation: 'server-start', ...connection.hello }))));
const waitForWorkspaceStop = (runtime: ServerRuntime['Service'], privateDir: string, token: string) => Effect.gen(function*() {
      for (;;) {
        const record = yield* Effect.try({ try: () => runtime.read(privateDir, false), catch: failure });
        // A replacement token can only be published after the previous owner released its lock.
        if (record && record.token !== token) return;
        if (!record && (yield* runtime.released(privateDir))) return;
        yield* Effect.sleep('10 millis');
      }
    }).pipe(Effect.timeout('10 seconds'), Effect.mapError(() => new ConcordError('CleanupFailed', 'Workspace service shutdown could not be confirmed')));
const stopWorkspaceServer = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const { privateDir } = yield* (yield* Workspace).locate(root, true);
  const token = yield* Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root);
    if (!connection) return undefined;
    yield* connection.client.shutdown({ token: connection.hello.token });
    return connection.hello.token;
  }));
  // Release the shutdown transport before waiting for the service's resources.
  if (token !== undefined) yield* waitForWorkspaceStop(runtime, privateDir, token);
  return { operation: 'server-stop' };
}).pipe(Effect.mapError(asServerError)));

const HttpLease = Schema.Struct({ host: Schema.String, port: Schema.Int, address: Schema.String, lease: Schema.String, token: Schema.String });
function makeWorkspaceView() { return Effect.fn('serveWorkspaceView')(function*(options: { root: string; host: string; port: number; inProcess?: boolean }, ready: (server: { root: string; host: string; port: number; address: string }) => void) {
  yield* builtAssetRoot('web');
  return yield* Effect.scoped(Effect.gen(function*() {
    const connection = yield* connectOrStartWorkspace(options.root, options.inProcess === true);
    const deadline = (yield* Clock.currentTimeMillis) + 60_000;
    let input: unknown;
    for (;;) {
      const attempt = yield* Effect.result(requestWorkspace(connection, 'http', { action: 'open', host: options.host, port: options.port }));
      if (attempt._tag === 'Success') { input = attempt.success; break; }
      if (remoteFailure(attempt.failure)?.code !== 'WorkspaceServerBusy' || (yield* Clock.currentTimeMillis) >= deadline) return yield* Effect.fail(attempt.failure);
      yield* Effect.sleep('10 millis');
    }
    const lease = yield* Schema.decodeUnknownEffect(HttpLease, { onExcessProperty: 'error' })(input);
    yield* Effect.addFinalizer(() => requestWorkspace(connection, 'http', { action: 'close', host: lease.host, port: lease.port, lease: lease.lease }).pipe(Effect.ignore));
    yield* Effect.sync(() => ready({ root: options.root, host: lease.host, port: lease.port, address: lease.address }));
    return yield* Effect.never;
  }));
}, Effect.mapError(workspaceServerFailure)); }
const serveWorkspaceView = /*#__PURE__*/ makeWorkspaceView();


// Queries connect through the same service; launch ownership stays at this entry.
function makeCliLayer() {
return Layer.unwrap(loadApp().pipe(Effect.map(({ Queries, QueryReply }) => {
const querySelection = Layer.unwrap(Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  const installation = yield* Installation;
  const processes = yield* OwnedProcess;
  const persistent = yield* PersistentCache;
  return Queries.Remote((root, request, cache = 'use') => Effect.scoped(Effect.gen(function*() {
    if (cache === 'off' && process.env.CONCORD_SERVER_SCOPE === undefined) return yield* executeQuery(root, request, cache);
    const native = yield* Effect.result(nativeAvailable.pipe(Effect.provideService(PersistentCache, persistent)));
    if (native._tag === 'Failure') {
      if (request.name === 'historical' || request.name === 'workspace.show') return yield* Effect.fail(native.failure);
      const reply = yield* executeQuery(root, request, 'off');
      const object = Schema.decodeUnknownExit(Schema.Record(Schema.String, Schema.Json))(reply.value);
      if (object._tag === 'Success' && object.value.cache !== undefined) {
        const observed = Schema.decodeUnknownExit(Schema.Record(Schema.String, Schema.Json))(object.value.cache);
        if (observed._tag === 'Success') return { ...reply, value: { ...object.value, cache: { ...observed.value, status: 'unavailable', detail: native.failure.message } } };
      }
      return reply;
    }
    const identified = yield* workspace.locate(root);
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete environment.CONCORD_SERVER_SCOPE;
    if (Buffer.byteLength(JSON.stringify(environment)) > 256 * 1024) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Query environment exceeds 256 KiB'));
    for (let attempt = 0; ; attempt++) {
      const result = yield* Effect.result(Effect.scoped(Effect.gen(function*() {
        const connection = yield* connectQueryWorkspace(identified.root, identified.privateDir).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.provideService(Installation, installation), Effect.provideService(OwnedProcess, processes), Effect.provideService(PersistentCache, persistent));
        yield* awaitQueryReady(connection);
        const reply = yield* requestWorkspace(connection, 'query', { ...request, environment, cache });
        return yield* Schema.decodeUnknownEffect(QueryReply, { onExcessProperty: 'error' })(reply).pipe(Effect.mapError(failure));
      })));
      if (result._tag === 'Success') return result.success;
      const error = workspaceServerFailure(result.failure);
      const retryable = error.code === 'WorkspaceServerUnavailable' || error.code === 'WorkspaceComputeExited' || error.code === 'OperationFailed' && remoteFailure(result.failure) === undefined;
      if (attempt >= 1 || !retryable || (yield* QueryServerMode) === 'command' || process.env.CONCORD_SERVER_SCOPE !== undefined) return yield* Effect.fail(error);
    }
  })));
}));

const feedbackSelection = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.catch(() => Effect.succeed(undefined)));
    if (!connection) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    if (connection.hello.installation !== runtime.installation()) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback owner has another installation identity'));
    return yield* (yield* loadClient()).submitFeedback(connection, connectionId, items);
  })) });
}));

const launchers = Layer.mergeAll(
  Layer.effect(ServerLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices | OwnedProcess>();
    const workspace = yield* Workspace, runtime = yield* ServerRuntime, persistent = yield* PersistentCache;
    return ServerLauncher.of({
      run: root => nativeAvailable.pipe(Effect.andThen(loadServerMain()), Effect.flatMap(server => server.serveWorkspaceFromEnvironment(root)), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause)), Effect.provideContext(context)),
      start: root => startWorkspaceServer(root).pipe(Effect.provideContext(context)),
      stop: root => stopWorkspaceServer(root).pipe(Effect.provideContext(context)),
      status: root => workspaceServerStatus(root).pipe(Effect.provideContext(context)),
      projection: root => readExistingWorkspaceProjection(root).pipe(Effect.provideContext(context)),
      clear: root => clearExistingWorkspaceCache(root).pipe(Effect.provideContext(context)),
      cache: (root, action) => Effect.scoped(Effect.gen(function*() {
        if ((yield* Effect.result(persistent.verifyArtifact))._tag === 'Failure') return undefined;
        const identified = yield* workspace.locate(root);
        const connection = yield* existingCompatibleWorkspace(identified.root, identified.privateDir).pipe(Effect.provideContext(context));
        return connection ? yield* requestWorkspace(connection, action, {}).pipe(Effect.mapError(workspaceServerFailure)) : undefined;
      })),
      withCache: (root, operation, required = false) => withWorkspaceCache(workspace, runtime, persistent, root, operation, required),
    });
  })),
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices | OwnedProcess>();
    return ViewLauncher.of({ serve: (options, ready) => Effect.gen(function*() {
      yield* builtAssetRoot('web');
      const http = yield* Effect.tryPromise(() => import('../http/index.ts'));
      return yield* serveWorkspaceView(options, info => ready({ ...info, ...http.viewAddresses(info.host, info.port) }));
    }).pipe(Effect.mapError(failure), Effect.provideContext(context)) });
  })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => Effect.tryPromise(() => import('../lsp/index.ts')).pipe(Effect.flatMap(lsp => lsp.serveEditor(root)), Effect.mapError(failure)) })),
);

const validation = Layer.unwrap(loadApp().pipe(Effect.map(app => app.PublicationValidationLive)));
const cliServices = Layer.mergeAll(ServerRuntime.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), PersistentCache.layer, Publication.layer.pipe(Layer.provide(validation))).pipe(
  Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer),
);
return launchers.pipe(Layer.merge(querySelection), Layer.merge(feedbackSelection), Layer.provideMerge(cliServices));
})));
}
export const cliLayer = /*#__PURE__*/ makeCliLayer();

const cliFailure = (cause: unknown) => Effect.tryPromise(() => import('effect/unstable/cli/CliError')).pipe(Effect.flatMap(CliError => Effect.sync(() => {
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})));
const runCommand = <R>(command: Command.Command<any, any, any, any, R>) => Effect.gen(function*() {
  const Command = yield* Effect.tryPromise(() => import('effect/unstable/cli/Command'));
  const version = yield* (yield* Installation).version;
  // @concord-begin
  // @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
  const { root } = yield* Effect.tryPromise(() => import('./cli-base.ts'));
  const guard = (fromSubdirectory = false) => Effect.gen(function*() {
    const settings = yield* root;
    const app = yield* loadApp();
    yield* app.requireInitializedProject(settings.root._tag === 'Some' ? settings.root.value : undefined, fromSubdirectory);
  });
  const commands = command.subcommands.flatMap(group => group.commands.map(child => {
    if (['init', 'template', 'herdr', 'doctor', 'server'].includes(child.name)) return child;
    if (child.name === 'view') return child.pipe(Command.withSubcommands(child.subcommands.flatMap(group => group.commands.map(nested => nested.pipe(Command.provideEffectDiscard(guard(true)))))));
    return child.pipe(Command.provideEffectDiscard(guard()));
  }));
  const guarded = command.pipe(Command.withSubcommands(commands)) as typeof command;
  // @concord-end
  return yield* guarded.pipe(Command.run({ version, renderErrors: !process.argv.includes('--json') }));
}).pipe(Effect.catch(cliFailure));
export function runCli(command: Command.Command<any, any, any, any, Queries | PersistentCache | Installation | Workspace | Sources | Git | LspLauncher | ViewLauncher | ServerLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.ts").OwnedProcess>): void {
  runCommand(command).pipe(Effect.provide(cliLayer), NodeRuntime.runMain);
}
