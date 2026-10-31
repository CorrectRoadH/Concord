// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { Installation } from '../../base/installation/index.js';
import { LspLauncher, ViewLauncher, ServerLauncher, PanelLauncher } from "./launchers.js";
import { Publication } from "../../base/publication/index.js";
import type { Queries } from "../../app/index.js";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Effect, Fiber, Layer, Schema } from "effect";
import type { Command } from "effect/unstable/cli";
import { ConcordError, failure, WorkspaceProjectionSchema } from "../../model/index.js";
import { humanOutput } from "./presentation.js";
import { OwnedProcess, OwnedProcessLive } from "../../base/process/index.js";
import { Git } from '../../base/git/index.js';
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { Cache, CacheSnapshot, PersistentCache, FeedbackCacheWriter } from '../../base/cache/index.js';
import { ServerRuntime } from '../../base/server-lock/index.js';
import { connectWorkspaceSocket, requestWorkspace, submitFeedback, waitForServerHandshake, PROTOCOL, FRAME_LIMIT, WorkspaceServerError } from '../server/index.js';

const asServerError = (cause: unknown) => { const error = workspaceServerFailure(cause); return new WorkspaceServerError({ code: error.code, message: error.message }); };
const workspaceServerFailure = (cause: unknown): ConcordError => cause instanceof WorkspaceServerError ? new ConcordError(cause.code, cause.message, cause.details) : failure(cause);

const loadServerMain = () => Effect.tryPromise(() => import('../server/main.js'));
const loadApp = () => Effect.tryPromise(() => import('../../app/index.js'));
const executeQuery: typeof import('../../app/index.js').executeQuery = (...args) => loadApp().pipe(Effect.flatMap(app => app.executeQuery(...args)), Effect.mapError(failure));
const mergeLocalFeedbackObservation: typeof import('../../app/index.js').mergeLocalFeedbackObservation = (...args) => loadApp().pipe(Effect.flatMap(app => app.mergeLocalFeedbackObservation(...args)), Effect.mapError(failure));
const builtAssetRoot = (name: 'web') => loadApp().pipe(Effect.flatMap(app => Effect.try({ try: () => app.builtAssetRoot(name), catch: failure })), Effect.mapError(failure));
const existingWorkspace = /*#__PURE__*/ Effect.fn('existingWorkspace')(function*(root: string, installation?: string, identifiedPrivateDir?: string) {
  const platform = yield* ServerRuntime;
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  const record = yield* Effect.try({ try: () => platform.read(privateDir), catch: failure });
  if (!record) return undefined;
  const connection = yield* connectWorkspaceSocket(record.socket.path, installation ?? platform.installation(), record.token);
  if (connection.hello.installation !== record.installation || connection.hello.protocol !== record.protocol) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Handshake differs from the running record'));
  return connection;
});
const workspaceServerStatus = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.map(connection => connection ? { operation: 'server-status', ...connection.hello } : { operation: 'server-status', state: 'absent' }), Effect.catch(() => Effect.succeed({ operation: 'server-status', state: 'absent' }))));
const readExistingWorkspaceProjection = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation() || connection.hello.protocol !== PROTOCOL) return undefined;
  if (connection.hello.state === 'opening') return yield* Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is opening'));
  return yield* requestWorkspace(connection, 'workspace', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(WorkspaceProjectionSchema, { onExcessProperty: 'error' })(value)), Effect.mapError(workspaceServerFailure));
}));
const clearExistingWorkspaceCache = (root: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection || connection.hello.installation !== runtime.installation() || connection.hello.protocol !== PROTOCOL) return undefined;
  return yield* requestWorkspace(connection, 'cache-clear', {}).pipe(Effect.mapError(workspaceServerFailure));
}));
const connectOrStartWorkspace = /*#__PURE__*/ Effect.fn('connectOrStartWorkspace')(function*(root: string, foreground = false, identifiedPrivateDir?: string) {
  const platform = yield* ServerRuntime;
  const installation = platform.installation();
  let current = yield* existingWorkspace(root, installation, identifiedPrivateDir).pipe(Effect.catch(() => Effect.succeed(undefined)));
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
  if (foreground) {
    const owner = yield* OwnedProcess, installed = yield* Installation;
    yield* Effect.forkScoped(Effect.scoped(owner.run([process.execPath, ...installed.worker('workspace-server'), root], { cwd: installed.cwd })));
  } else yield* OwnedProcess.launch('workspace-server', [root], (yield* ServerRuntime).cwd);
  return yield* waitForServerHandshake(existingWorkspace(root, installation).pipe(Effect.map(connection => connection?.hello.installation === installation && connection.hello.protocol === PROTOCOL ? connection : undefined)));
});
const startWorkspaceServer = (root: string) => Effect.scoped(connectOrStartWorkspace(root).pipe(Effect.map(connection => ({ operation: 'server-start', ...connection.hello }))));
const stopWorkspaceServer = (root: string) => Effect.scoped(existingWorkspace(root).pipe(Effect.flatMap(connection => connection ? connection.client.shutdown({ token: connection.hello.token }) : Effect.void), Effect.as({ operation: 'server-stop' }), Effect.mapError(asServerError)));

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
      if (!(attempt.failure instanceof WorkspaceServerError) || attempt.failure.code !== 'WorkspaceServerBusy' || (yield* Clock.currentTimeMillis) >= deadline) return yield* Effect.fail(attempt.failure);
      yield* Effect.sleep('10 millis');
    }
    const lease = yield* Schema.decodeUnknownEffect(HttpLease, { onExcessProperty: 'error' })(input);
    yield* Effect.addFinalizer(() => requestWorkspace(connection, 'http', { action: 'close', host: lease.host, port: lease.port, lease: lease.lease }).pipe(Effect.ignore));
    yield* Effect.sync(() => ready({ root: options.root, host: lease.host, port: lease.port, address: lease.address }));
    return yield* Effect.never;
  }));
}, Effect.mapError(workspaceServerFailure)); }
const serveWorkspaceView = /*#__PURE__*/ makeWorkspaceView();


// Discovery needs only the base ports. Commands without an owner avoid loading
// the service's RPC, HTTP and computation entrypoints into their short lifetime.
const panelLauncher = Layer.effect(PanelLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | NodeServices.NodeServices | OwnedProcess>();
    const workspace = yield* Workspace;
    return PanelLauncher.of({ serve: root => Effect.scoped(Effect.gen(function*() {
      const location = yield* workspace.identify(root, false, true).pipe(Effect.mapError(error => /not a git repository/iu.test(error.message) ? new ConcordError(error.code, `${error.message}; run concord init in a Git worktree`, error.details) : error));
      if (location.config === null) return yield* Effect.fail(new ConcordError('ProjectNotFound', 'No Concord configuration; run concord init in this Git worktree'));
      const [panel, connection] = yield* Effect.all([Effect.tryPromise(() => import('../panel/index.js')), connectOrStartWorkspace(location.root, false, location.privateDir)], { concurrency: 'unbounded' });
      return yield* panel.serveWorkspacePanel(location.root, path => connectOrStartWorkspace(path).pipe(Effect.provideContext(context)), connection);
    })).pipe(Effect.provideContext(context)) });
  }));
function makeCliLayer() {
return Layer.unwrap(loadApp().pipe(Effect.map(({ Queries, QueryReply }) => {
const querySelection = Layer.unwrap(Effect.gen(function*() {
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

const feedbackSelection = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.catch(() => Effect.succeed(undefined)));
    if (!connection) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    if (connection.hello.installation !== runtime.installation()) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback owner has another installation identity'));
    return yield* submitFeedback(connection, connectionId, items);
  })) });
}));

const launchers = Layer.mergeAll(
  panelLauncher,
  Layer.effect(ServerLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices | OwnedProcess>();
    return ServerLauncher.of({
      run: root => loadServerMain().pipe(Effect.flatMap(server => server.serveWorkspace(root)), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause)), Effect.provideContext(context)),
      start: root => startWorkspaceServer(root).pipe(Effect.provideContext(context)),
      stop: root => stopWorkspaceServer(root).pipe(Effect.provideContext(context)),
      status: root => workspaceServerStatus(root).pipe(Effect.provideContext(context)),
      projection: root => readExistingWorkspaceProjection(root).pipe(Effect.provideContext(context)),
      clear: root => clearExistingWorkspaceCache(root).pipe(Effect.provideContext(context)),
    });
  })),
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices | OwnedProcess>();
    return ViewLauncher.of({ serve: (options, ready) => Effect.gen(function*() {
      yield* builtAssetRoot('web');
      const http = yield* Effect.tryPromise(() => import('../http/index.js'));
      return yield* serveWorkspaceView(options, info => ready({ ...info, ...http.viewAddresses(info.host, info.port) }));
    }).pipe(Effect.mapError(failure), Effect.provideContext(context)) });
  })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => Effect.tryPromise(() => import('../lsp/index.js')).pipe(Effect.flatMap(lsp => lsp.serveEditor(root)), Effect.mapError(failure)) })),
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
  return yield* command.pipe(Command.run({ version, renderErrors: !process.argv.includes('--json') }));
}).pipe(Effect.catch(cliFailure));
const panelCliLayer = panelLauncher.pipe(Layer.provideMerge(Layer.mergeAll(ServerRuntime.layer, Installation.layer, Workspace.layer)), Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer));
export function runPanelInvocation(root: string | undefined): void {
  Effect.gen(function*() { yield* (yield* PanelLauncher).serve(root); }).pipe(Effect.catch(cliFailure), Effect.provide(panelCliLayer), NodeRuntime.runMain);
}
export function runPanelCli(command: Command.Command<any, any, any, any, PanelLauncher>): void {
  runCommand(command).pipe(Effect.provide(panelCliLayer), NodeRuntime.runMain);
}
export function runCli(command: Command.Command<any, any, any, any, Queries | PersistentCache | Installation | Workspace | Sources | Git | LspLauncher | ViewLauncher | ServerLauncher | PanelLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.js").OwnedProcess>): void {
  runCommand(command).pipe(Effect.provide(cliLayer), NodeRuntime.runMain);
}
