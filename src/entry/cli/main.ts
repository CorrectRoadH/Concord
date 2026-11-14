// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
// @concord-implements docs/feature/local-data-engine/architecture.md#cli-查询
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import type * as ServerTypes from '../server/index.ts';
import type * as AppTypes from '../../app/index.ts';
import type * as ProcessTypes from '../../base/process/index.ts';
import { Installation, builtAssetRoot } from '../../base/installation/index.ts';
import { LspLauncher, ViewLauncher, ServerLauncher, QueryServerMode } from "./launchers.ts";
import { Publication } from "../../base/publication/index.ts";
import type { Queries } from "../../app/index.ts";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { Cause, Clock, ConfigProvider, Console, Context, Effect, Fiber, Layer, Option, Queue, Schema, Stdio, Stream, type Terminal } from "effect";
import type { Command } from "effect/cli";
import { ConcordError, failure, WorkspaceProjectionSchema } from "../../model/index.ts";
import { humanOutput } from "./presentation.ts";
import { OwnedProcess, OwnedProcessLive, ProcessEventsLive, makeOwnedProcessService } from "../../base/process/index.ts";
import { Git } from '../../base/git/index.ts';
import { Workspace } from '../../base/workspace/index.ts';
import { Sources } from '../../base/sources/index.ts';
import { Cache, CacheSnapshot, CacheDerivations, PersistentCache, FeedbackCacheWriter } from '../../base/cache/index.ts';
import { mergeLocalFeedbackObservation } from '../../domain/feedback/index.ts';
import { ServerRuntime } from '../../base/server-lock/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../base/environment/index.ts';
import { CliInvocation, writeStderr } from './invocation.ts';
import { cliFailure } from './cli-failure.ts';
import { retryWorkspaceRead } from './workspace-retry.ts';

export const cliPlatformLayer = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
/** Real startup captures input; this composition root binds its services. */
export function cliEnvironmentLayer(cwd: string, env: Readonly<Record<string, string | undefined>>) {
  const runtime = makeRuntimeEnvironment(cwd, env);
  return Layer.merge(RuntimeEnvironment.layer(runtime), ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env)));
}
const stderrWriter = Effect.gen(function*() {
  const stdio = yield* Stdio.Stdio;
  const chunks = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const writing = yield* Effect.forkScoped(Stream.fromQueue(chunks).pipe(Stream.run(stdio.stderr({ endOnDone: false }))));
  yield* Effect.addFinalizer(() => Queue.end(chunks).pipe(Effect.andThen(Fiber.join(writing)), Effect.orDie));
  return (chunk: Uint8Array) => { Queue.offerUnsafe(chunks, chunk); };
});
const loadClient = () => Effect.tryPromise(() => import('../server/index.ts')).pipe(Effect.mapError(failure));
const requestWorkspace: typeof ServerTypes.requestWorkspace = (...args) => loadClient().pipe(Effect.flatMap(client => client.requestWorkspace(...args)));
const ServerFailure = Schema.Struct({ _tag: Schema.Literal('WorkspaceServerError'), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) });
const remoteFailure = (cause: unknown): ConcordError | undefined => {
  const decoded = Schema.decodeUnknownExit(ServerFailure, { onExcessProperty: 'ignore' })(cause);
  return decoded._tag === 'Success' ? new ConcordError(decoded.value.code, decoded.value.message, decoded.value.details) : undefined;
};
const workspaceServerFailure = (cause: unknown): ConcordError => remoteFailure(cause) ?? failure(cause);
const asServerError = workspaceServerFailure;
const installationIdentity = (runtime: ServerRuntime['Service']) => Effect.try({ try: () => runtime.installation(), catch: failure });
const readWorkspaceRecord = Effect.fn('cli.readWorkspaceRecord')(function*(runtime: ServerRuntime['Service'], privateDir: string, requireSocket = true) {
  const read = yield* Effect.result(Effect.try({ try: () => runtime.read(privateDir, requireSocket), catch: failure }));
  if (read._tag === 'Success') return read.success;
  // Reboot or remount can invalidate a dead owner's device/socket identity.
  // Only the actual native lock can establish absence; the next server still
  // acquires that lock before replacing the record or touching its socket.
  if (read.failure.code === 'WorkspaceServerUnavailable' && (yield* runtime.released(privateDir))) return undefined;
  return yield* Effect.fail(read.failure);
});
const nativeAvailable = Effect.flatMap(PersistentCache, cache => cache.verifyArtifact).pipe(
  Effect.mapError(cause => new ConcordError('HawdbUnavailable', cause.message)),
);

const PendingRefresh = Schema.Struct({ refresh: Schema.Json });
/** Keep the requesting connection alive while the service owns the first scan. */
const queryWithFirstProjection = Effect.fn('queryWithFirstProjection')(function*(connection: ServerTypes.WorkspaceConnection, request: Parameters<typeof ServerTypes.requestWorkspace<'query'>>[2], json: boolean) {
  const startedAt = yield* Clock.currentTimeMillis;
  const limitMs = 120_000;
  let initialFailure: string | undefined;
  let announced = false;
  for (;;) {
    const reply = yield* Effect.result(requestWorkspace(connection, 'query', request));
    if (reply._tag === 'Success') return reply.success;
    const error = workspaceServerFailure(reply.failure);
    if (request.name !== 'historical' || error.code !== 'QueryPending') return yield* Effect.fail(error);
    const details = Schema.decodeUnknownExit(PendingRefresh, { onExcessProperty: 'ignore' })(error.details);
    const refresh = details._tag === 'Success' ? details.value.refresh : 'requested';
    const observedFailure = typeof refresh === 'object' && refresh !== null ? JSON.stringify(refresh) : undefined;
    if (!announced) {
      initialFailure = observedFailure;
      announced = true;
      if (!json) yield* writeStderr('Building diagnostic snapshot…\n');
    } else if (observedFailure !== undefined && observedFailure !== initialFailure) return yield* Effect.fail(error);
    const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
    if (elapsedMs >= limitMs) return yield* Effect.fail(new ConcordError('QueryPending', 'No readable diagnostic snapshot. Use --fresh to wait for current sources.', {
      refresh: { code: 'QueryRefreshTimedOut', message: 'Diagnostic snapshot was not published within the refresh limit', elapsedMs, limitMs },
    }));
    yield* Effect.sleep(Math.min(100, limitMs - elapsedMs));
  }
}, Effect.timeoutOrElse({ duration: '120 seconds', orElse: () => Effect.fail(new ConcordError('QueryPending', 'No readable diagnostic snapshot. Use --fresh to wait for current sources.', {
  refresh: { code: 'QueryRefreshTimedOut', message: 'Diagnostic snapshot was not published within the refresh limit', elapsedMs: 120_000, limitMs: 120_000 },
})) }));

const loadServerMain = () => Effect.tryPromise(() => import('../server/main.ts'));
const loadApp = () => Effect.tryPromise(() => import('../../app/index.ts'));
const executeQuery: typeof AppTypes.executeQuery = (...args) => loadApp().pipe(Effect.flatMap(app => app.executeQuery(...args)), Effect.mapError(failure));
const existingWorkspace = /*#__PURE__*/ Effect.fn('existingWorkspace')(function*(root: string, installation?: string, identifiedPrivateDir?: string, scope?: string, countReuse = true) {
  const platform = yield* ServerRuntime;
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  const record = yield* readWorkspaceRecord(platform, privateDir);
  if (!record) return undefined;
  const { connectWorkspaceSocket } = yield* loadClient();
  const connection = yield* connectWorkspaceSocket(record.socket.path, installation ?? (yield* installationIdentity(platform)), record.token, scope, countReuse, (yield* RuntimeEnvironment).env);
  if (connection.hello.installation !== record.installation || connection.hello.protocol !== record.protocol) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Handshake differs from the running record'));
  return connection;
});
const workspaceServerStatus = Effect.fn('cli.workspaceServerStatus')(function*(root: string, wait = false) {
  // Each observation releases its connection before a later handshake attempt.
  const observe = Effect.scoped(existingWorkspace(root).pipe(Effect.map(connection => connection ? { operation: 'server-status', ...connection.hello } : undefined)));
  const observed = yield* Effect.result(wait ? (yield* loadClient()).waitForServerHandshake(observe) : observe);
  if (observed._tag === 'Success' && observed.success) return observed.success;
  const runtime = yield* ServerRuntime;
  const { privateDir } = yield* (yield* Workspace).locate(root, true);
  const record = yield* readWorkspaceRecord(runtime, privateDir, false);
  if ((yield* runtime.released(privateDir)) && (!record || (yield* runtime.processExited(record.pid)))) {
    if (wait && observed._tag === 'Failure') return yield* Effect.fail(observed.failure);
    return { operation: 'server-status', state: 'absent' };
  }
  return yield* Effect.fail(yield* workspaceCleanupFailure(runtime, privateDir, record));
});

const workspaceCleanupFailure = Effect.fn('cli.workspaceCleanupFailure')(function*(runtime: ServerRuntime['Service'], privateDir: string, prior?: ReturnType<ServerRuntime['Service']['read']>) {
  const current = yield* readWorkspaceRecord(runtime, privateDir, false);
  const replaced = prior !== undefined && current !== undefined && prior.token !== current.token;
  const record = replaced ? prior : current ?? prior;
  const released = replaced || (yield* runtime.released(privateDir));
  const phase = released ? 'process-exit' : record?.cleanup?.phase ?? (record?.state === 'stopping' ? 'resources' : record ? 'handshake' : 'service-lock');
  const pid = record?.cleanup?.pid ?? record?.pid ?? null;
  return new ConcordError('CleanupFailed', `Workspace service shutdown could not be confirmed: ${phase} (PID ${pid ?? 'unknown'})`, {
    phase, pid, servicePid: record?.pid ?? null, token: record?.token ?? null, state: record?.state ?? 'unknown',
  });
});
const canRetryWorkspaceRead = Effect.gen(function*() {
  return (yield* QueryServerMode) === 'shared' && (yield* RuntimeEnvironment).env.CONCORD_SERVER_SCOPE === undefined;
});
const readExistingWorkspaceProjection = (root: string) => Effect.gen(function*() {
  return yield* retryWorkspaceRead(retry => Effect.scoped(Effect.gen(function*() {
  const connection = retry ? yield* connectOrStartWorkspace(root, false, undefined, undefined, false, retry) : yield* existingWorkspace(root);
  if (!connection) return undefined;
  if (connection.hello.protocol !== (yield* loadClient()).PROTOCOL) return undefined;
  if (connection.hello.state === 'opening') return yield* Effect.fail(new ConcordError('WorkspaceProjectionPending', 'Workspace is opening'));
  return yield* requestWorkspace(connection, 'workspace', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(WorkspaceProjectionSchema, { onExcessProperty: 'error' })(value)), Effect.mapError(workspaceServerFailure));
})).pipe(Effect.mapError(workspaceServerFailure)), yield* canRetryWorkspaceRead);
});
const clearExistingWorkspaceCache = (root: string) => Effect.scoped(Effect.gen(function*() {
  const connection = yield* existingWorkspace(root).pipe(Effect.catch(() => Effect.succeed(undefined)));
  if (!connection) return undefined;
  if (connection.hello.protocol !== (yield* loadClient()).PROTOCOL) return undefined;
  return yield* requestWorkspace(connection, 'cache-clear', {}).pipe(Effect.mapError(workspaceServerFailure));
}));
const connectInheritedWorkspace = Effect.fn('cli.connectInheritedWorkspace')(function*(root: string, privateDir: string, installation: string, inherited: string) {
  const client = yield* loadClient();
  const scope = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(client.CommandScope), { onExcessProperty: 'error' })(inherited).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeMismatch', 'Invalid inherited command scope')));
  if (scope.root !== root || scope.privateDir !== privateDir) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeMismatch', 'Inherited command scope belongs to another project'));
  const connection = yield* existingWorkspace(root, installation, privateDir, scope.key).pipe(Effect.mapError(() => new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service is unavailable')));
  if (!connection) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service has ended'));
  if (connection.hello.protocol !== client.PROTOCOL) return yield* Effect.fail(new ConcordError('WorkspaceServerScopeExpired', 'The inherited command service is unavailable'));
  return connection;
});
const connectOrStartWorkspace = /*#__PURE__*/ Effect.fn('connectOrStartWorkspace')(function*(root: string, foreground = false, identifiedPrivateDir?: string, capturedInstallation?: string, artifactVerified = false, retry = false) {
  if (!artifactVerified) yield* nativeAvailable;
  const { PROTOCOL, waitForServerHandshake } = yield* loadClient();
  const platform = yield* ServerRuntime;
  const installation = capturedInstallation ?? (yield* installationIdentity(platform));
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  const inherited = (yield* RuntimeEnvironment).env.CONCORD_SERVER_SCOPE;
  if (inherited !== undefined) return yield* connectInheritedWorkspace(root, privateDir, installation, inherited);
  for (;;) {
    yield* prepareWorkspaceRecord(root, privateDir);
    if (!retry) {
      const current = yield* existingWorkspace(root, installation, privateDir).pipe(Effect.catch(cause => {
        const error = workspaceServerFailure(cause);
        return error.code.startsWith('WorkspaceServerScope') ? Effect.fail(error) : Effect.succeed(undefined);
      }));
      if (current) {
        if (current.hello.protocol === PROTOCOL) return current;
        // A different starter can win between the record check and handshake.
        continue;
      }
    }
    retry = false;
    // A failed handshake does not transfer ownership. An opening competitor may
    // still publish its socket; wait for it without launching another process.
    if (!(yield* platform.released(privateDir))) {
      const connected = yield* Effect.result(waitForServerHandshake(existingWorkspace(root, installation, privateDir, undefined, false)));
      if (connected._tag === 'Success') {
        if (connected.success.hello.protocol === PROTOCOL) return connected.success;
        continue;
      }
      if (yield* platform.released(privateDir)) continue;
      return yield* Effect.fail(yield* workspaceCleanupFailure(platform, privateDir));
    }
    if (foreground) {
      const owner = yield* OwnedProcess, installed = yield* Installation;
      const stderr = yield* stderrWriter;
      yield* Effect.forkScoped(Effect.scoped(owner.run([process.execPath, ...installed.worker('workspace-server'), root], { cwd: (yield* RuntimeEnvironment).cwd, stream: { ready: () => {}, stdout: () => {}, stderr } })));
    } else yield* OwnedProcess.launch('workspace-server', [root], (yield* RuntimeEnvironment).cwd);
    const connection = yield* waitForServerHandshake(existingWorkspace(root, installation, privateDir, undefined, false));
    if (connection.hello.protocol === PROTOCOL) return connection;
  }
});

const prepareWorkspaceRecord = Effect.fn('cli.prepareWorkspaceRecord')(function*(root: string, privateDir: string) {
  const runtime = yield* ServerRuntime, client = yield* loadClient();
  const record = yield* readWorkspaceRecord(runtime, privateDir, false);
  if (!record) return 'absent' as const;
  if (record.state === 'stopping' || (yield* runtime.released(privateDir))) {
    yield* waitForWorkspaceStop(runtime, privateDir, record);
    return 'stopped' as const;
  }
  if (record.protocol === client.PROTOCOL) return 'compatible' as const;
  yield* stopWorkspaceServer(root, privateDir);
  return 'stopped' as const;
});

const connectQueryWorkspace = Effect.fn('connectQueryWorkspace')(function*(root: string, privateDir: string, retry = false) {
  const client = yield* loadClient();
  const runtime = yield* ServerRuntime;
  const installation = yield* installationIdentity(runtime);
  const inherited = (yield* RuntimeEnvironment).env.CONCORD_SERVER_SCOPE;
  if (inherited !== undefined) return yield* connectInheritedWorkspace(root, privateDir, installation, inherited);
  // Query selection has already verified the same installation for fallback.
  if ((yield* QueryServerMode) === 'shared') return yield* connectOrStartWorkspace(root, false, privateDir, installation, true, retry);
  const record = yield* readWorkspaceRecord(runtime, privateDir, false);
  if (record && !(yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure)))) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'A service already owns this project; command mode cannot attach to it'));
  const current = yield* existingWorkspace(root, installation, privateDir).pipe(Effect.catch(cause => {
    const error = workspaceServerFailure(cause);
    return error.code.startsWith('WorkspaceServerScope') ? Effect.fail(new ConcordError('WorkspaceServerBusy', 'A command service already owns this project')) : Effect.succeed(undefined);
  }));
  if (current) return yield* Effect.fail(new ConcordError('WorkspaceServerBusy', 'A service already owns this project; command mode cannot attach to it'));
  const scope = { root, privateDir, key: crypto.randomUUID() };
  const owner = makeOwnedProcessService({ graceMs: 5000, environment: yield* RuntimeEnvironment });
  const installed = yield* Installation;
  yield* Effect.addFinalizer(() => owner.cleanupResults.pipe(Effect.flatMap(results => results.some(result => !OwnedProcess.confirmed(result))
    ? Effect.die(new ConcordError('CleanupFailed', 'Command service process group cleanup is unconfirmed')) : Effect.void)));
  const fiber = yield* Effect.forkScoped(Effect.scoped(owner.run([process.execPath, ...installed.worker('workspace-server'), root], {
    cwd: (yield* RuntimeEnvironment).cwd, env: { ...(yield* RuntimeEnvironment).env, CONCORD_SERVER_SCOPE: JSON.stringify(scope) },
    ipc: { ready: () => {}, message: () => {} },
  })));
  const connection = yield* client.waitForServerHandshake(existingWorkspace(root, installation, privateDir, scope.key, false)).pipe(
    Effect.raceFirst(Fiber.join(fiber).pipe(Effect.flatMap(() => Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Command service exited before completing startup'))))),
  );
  yield* Effect.addFinalizer(() => connection.client.shutdown({ token: connection.hello.token, scope: scope.key }).pipe(
    Effect.ignore, Effect.andThen(Fiber.join(fiber).pipe(Effect.timeout('3 seconds'), Effect.catch(() => Fiber.interrupt(fiber)))), Effect.asVoid,
  ));
  return connection;
});

const awaitQueryReady = Effect.fn('awaitQueryReady')(function*(connection: ServerTypes.WorkspaceConnection) {
  let hello = connection.hello;
  while (hello.state === 'opening') {
    yield* Effect.sleep('10 millis');
    hello = yield* connection.client.hello({ protocol: (yield* loadClient()).PROTOCOL, installation: connection.identity().installation, scope: connection.identity().scope });
  }
}, Effect.timeout('60 seconds'));

const existingCompatibleWorkspace = Effect.fn('existingCompatibleWorkspace')(function*(root: string, privateDir: string) {
  const client = yield* loadClient(), runtime = yield* ServerRuntime;
  const installation = yield* installationIdentity(runtime);
  const inherited = (yield* RuntimeEnvironment).env.CONCORD_SERVER_SCOPE;
  let connection: ServerTypes.WorkspaceConnection | undefined;
  if (inherited !== undefined) {
    connection = yield* connectInheritedWorkspace(root, privateDir, installation, inherited);
  } else {
    const state = yield* prepareWorkspaceRecord(root, privateDir);
    if (state === 'absent') return undefined;
    connection = state === 'stopped' ? yield* connectOrStartWorkspace(root, false, privateDir, installation, true) : yield* existingWorkspace(root, installation, privateDir).pipe(Effect.catch(cause => Effect.gen(function*() {
      if (yield* runtime.released(privateDir).pipe(Effect.mapError(workspaceServerFailure))) return undefined;
      return yield* Effect.fail(workspaceServerFailure(cause));
    })));
    if (connection && connection.hello.protocol !== client.PROTOCOL) connection = yield* connectOrStartWorkspace(root, false, privateDir, installation, true);
  }
  if (connection) yield* awaitQueryReady(connection).pipe(Effect.mapError(workspaceServerFailure));
  return connection;
});

function withWorkspaceCache<A, E, R>(workspace: Workspace['Service'], runtime: ServerRuntime['Service'], local: PersistentCache['Service'], root: string | undefined, operation: Effect.Effect<A, E, R>, required: boolean) {
  return Effect.scoped(Effect.gen(function*() {
    // A damaged source installation cannot authenticate a remote owner. The
    // repository cache reports the same unavailable diagnostic on the local path.
    if ((yield* Effect.result(local.verifyArtifact))._tag === 'Failure') return yield* operation;
    const identified = yield* workspace.locate(root);
    const client = yield* loadClient();
    // Retrying snapshot acquisition is safe even when the local operation writes.
    // Keep publication and cache submission outside this retry boundary.
    const acquired = yield* retryWorkspaceRead(retry => Effect.gen(function*() {
      const connection = retry ? yield* connectOrStartWorkspace(identified.root, false, identified.privateDir, undefined, true, retry) : yield* existingCompatibleWorkspace(identified.root, identified.privateDir);
      if (!connection) return undefined;
      const snapshot = yield* requestWorkspace(connection, 'cache-snapshot', {}).pipe(Effect.flatMap(value => Schema.decodeUnknownEffect(client.Snapshot, { onExcessProperty: 'error' })(value)));
      return { connection, snapshot };
    }).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.mapError(workspaceServerFailure)), yield* canRetryWorkspaceRead);
    if (!acquired) return yield* operation;
    const { connection, snapshot } = acquired;
    const derived = CacheDerivations.make();
    const cache = Context.get(yield* Layer.build(CacheSnapshot.layer(snapshot)), CacheSnapshot);
    const result = yield* operation.pipe(Effect.provideService(PersistentCache, {
      ...local,
      attach: repo => repo.privateDir === identified.privateDir ? cache.attach(repo).pipe(Effect.provideService(CacheDerivations, derived)) : local.attach(repo),
    }));
    yield* Effect.gen(function*() {
      yield* client.submitDerivations(connection, yield* derived.batches);
    }).pipe(Effect.catchCause(cause => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      const reason = workspaceServerFailure(Cause.squash(cause));
      const details = { reason: { code: reason.code, message: reason.message, ...(reason.details === undefined ? {} : { details: reason.details }) } };
      const message = 'The operation completed, but its disposable cache update failed';
      return required ? Effect.fail(new ConcordError('CacheUpdateFailed', message, details)) : writeStderr(`${JSON.stringify({ warning: 'CacheUpdateFailed', message, reason: reason.code, details })}\n`).pipe(Effect.orDie);
    }));
    return result;
  }));
}
const startWorkspaceServer = (root: string) => Effect.scoped(connectOrStartWorkspace(root).pipe(Effect.map(connection => ({ operation: 'server-start', ...connection.hello }))));
const waitForWorkspaceStop = (runtime: ServerRuntime['Service'], privateDir: string, owner?: { token: string; pid: number }) => Effect.gen(function*() {
      let observed: ReturnType<ServerRuntime['Service']['read']>;
      const result = yield* Effect.result(Effect.gen(function*() {
      for (;;) {
        const record = yield* readWorkspaceRecord(runtime, privateDir, false);
        if (record && (owner === undefined || record.token === owner.token)) observed = record;
        // A replacement token can only be published after the previous owner released its lock.
        const released = record && owner !== undefined && record.token !== owner.token ? true : yield* runtime.released(privateDir);
        // A dead owner can leave its record behind; only the native lock
        // determines whether it still owns any service resources.
        if (released && (owner === undefined || (yield* runtime.processExited(owner.pid)))) return;
        yield* Effect.sleep('10 millis');
      }
      }).pipe(Effect.timeout('10 seconds')));
      if (result._tag === 'Failure') return yield* Effect.fail(yield* workspaceCleanupFailure(runtime, privateDir, observed));
    });
const stopWorkspaceServer = (root: string, identifiedPrivateDir?: string) => Effect.scoped(Effect.gen(function*() {
  const runtime = yield* ServerRuntime;
  const privateDir = identifiedPrivateDir ?? (yield* (yield* Workspace).locate(root, true)).privateDir;
  const owner = yield* Effect.scoped(Effect.gen(function*() {
    const record = yield* readWorkspaceRecord(runtime, privateDir, false);
    if (!record) { yield* waitForWorkspaceStop(runtime, privateDir); return undefined; }
    const owner = { token: record.token, pid: record.pid };
    if (yield* runtime.released(privateDir)) return owner;
    if (record.state === 'stopping') return owner;
    return yield* Effect.gen(function*() {
      const connection = yield* existingWorkspace(root, record.installation, privateDir);
      if (!connection) return owner;
      yield* connection.client.shutdown({ token: connection.hello.token });
      return { token: connection.hello.token, pid: record.pid };
    // Transport loss can race the running -> stopping transition. Always use
    // the bounded ownership wait below; a momentary running record is not proof
    // that shutdown failed, and an unresponsive owner still fails at its deadline.
    }).pipe(Effect.catch(() => Effect.succeed(owner)));
  }));
  // Release the shutdown transport before waiting for the service's resources.
  if (owner !== undefined) yield* waitForWorkspaceStop(runtime, privateDir, owner);
  return { operation: 'server-stop' };
}).pipe(Effect.mapError(asServerError)));

const HttpLease = Schema.Struct({ host: Schema.String, port: Schema.Int, address: Schema.String, lease: Schema.String, token: Schema.String });
function makeWorkspaceView() { return Effect.fn('serveWorkspaceView')(function*(options: { root: string; host: string; port: number; inProcess?: boolean }, ready: (server: { root: string; host: string; port: number; address: string }) => Effect.Effect<void, unknown, Stdio.Stdio>) {
  builtAssetRoot('web');
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
    yield* ready({ root: options.root, host: lease.host, port: lease.port, address: lease.address });
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
  const execution = yield* RuntimeEnvironment;
  const stdio = yield* Stdio.Stdio;
  const invocation = yield* Effect.serviceOption(CliInvocation);
  return Queries.Remote((root, request, cache = 'use') => Effect.scoped(Effect.gen(function*() {
    if (cache === 'off' && execution.env.CONCORD_SERVER_SCOPE === undefined) return yield* executeQuery(root, request, cache);
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
    const environment = Object.fromEntries(Object.entries(execution.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete environment.CONCORD_SERVER_SCOPE;
    if (Buffer.byteLength(JSON.stringify(environment)) > 256 * 1024) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Query environment exceeds 256 KiB'));
    return yield* retryWorkspaceRead(retry => Effect.scoped(Effect.gen(function*() {
        const connection = yield* connectQueryWorkspace(identified.root, identified.privateDir, retry).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.provideService(Installation, installation), Effect.provideService(OwnedProcess, processes), Effect.provideService(PersistentCache, persistent));
        yield* awaitQueryReady(connection);
        const reply = yield* queryWithFirstProjection(connection, { ...request, cwd: execution.cwd, environment, cache }, Option.isSome(invocation) && invocation.value.argv.includes('--json'));
        return yield* Schema.decodeUnknownEffect(QueryReply, { onExcessProperty: 'error' })(reply).pipe(Effect.mapError(failure));
      })).pipe(Effect.mapError(workspaceServerFailure)), yield* canRetryWorkspaceRead);
  })).pipe(Effect.provideService(Stdio.Stdio, stdio), Effect.provideService(RuntimeEnvironment, execution)));
}));

const feedbackSelection = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  const execution = yield* RuntimeEnvironment;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.scoped(Effect.gen(function*() {
    const connection = yield* existingWorkspace(root).pipe(Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime), Effect.provideService(RuntimeEnvironment, execution), Effect.catch(() => Effect.succeed(undefined)));
    if (!connection) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    if (connection.hello.protocol !== (yield* loadClient()).PROTOCOL) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Feedback owner has another protocol'));
    return yield* (yield* loadClient()).submitFeedback(connection, connectionId, items);
  })) });
}));

const launchers = Layer.mergeAll(
  Layer.effect(ServerLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | Layer.Success<typeof cliPlatformLayer> | OwnedProcess | RuntimeEnvironment | Stdio.Stdio | Terminal.Terminal>();
    const workspace = yield* Workspace, runtime = yield* ServerRuntime, persistent = yield* PersistentCache;
    return ServerLauncher.of({
      processIdentity: installationIdentity(runtime).pipe(Effect.map(installation => ({ pid: process.pid, installation }))),
      run: root => nativeAvailable.pipe(Effect.andThen(loadServerMain()), Effect.flatMap(server => server.serveWorkspaceFromEnvironment(root)), Effect.catch(cause => cause instanceof Object && '_tag' in cause && cause._tag === 'ServerLockHeld' ? Effect.void : Effect.fail(cause)), Effect.provideContext(context)),
      start: root => startWorkspaceServer(root).pipe(Effect.provideContext(context)),
      stop: root => stopWorkspaceServer(root).pipe(Effect.provideContext(context)),
      status: (root, wait) => workspaceServerStatus(root, wait).pipe(Effect.provideContext(context)),
      projection: root => readExistingWorkspaceProjection(root).pipe(Effect.provideContext(context)),
      wait: (root, after, timeout) => Effect.gen(function*() {
        return yield* retryWorkspaceRead(retry => Effect.scoped(Effect.gen(function*() {
        yield* nativeAvailable;
        const identified = yield* workspace.locate(root);
        const connection = yield* connectQueryWorkspace(identified.root, identified.privateDir, retry);
        const client = yield* loadClient();
        return yield* client.waitForWorkspaceResult(client.subscribeWorkspace(connection), after, timeout);
        })).pipe(Effect.mapError(workspaceServerFailure)), yield* canRetryWorkspaceRead);
      }).pipe(Effect.provideContext(context)),
      clear: root => clearExistingWorkspaceCache(root).pipe(Effect.provideContext(context)),
      cache: (root, action) => Effect.gen(function*() {
        return yield* retryWorkspaceRead(retry => Effect.scoped(Effect.gen(function*() {
        if ((yield* Effect.result(persistent.verifyArtifact))._tag === 'Failure') return undefined;
        const identified = yield* workspace.locate(root);
        const connection = retry ? yield* connectOrStartWorkspace(identified.root, false, identified.privateDir, undefined, true, retry) : yield* existingCompatibleWorkspace(identified.root, identified.privateDir);
        return connection ? yield* requestWorkspace(connection, action, {}).pipe(Effect.mapError(workspaceServerFailure)) : undefined;
        })).pipe(Effect.mapError(workspaceServerFailure)), action === 'cache-status' && (yield* canRetryWorkspaceRead));
      }).pipe(Effect.provideContext(context)),
      withCache: (root, operation, required = false) => withWorkspaceCache(workspace, runtime, persistent, root, operation, required).pipe(Effect.provideContext(context)),
    });
  })),
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | Layer.Success<typeof cliPlatformLayer> | OwnedProcess | RuntimeEnvironment | Stdio.Stdio | Terminal.Terminal>();
    return ViewLauncher.of({ serve: (options, ready) => Effect.gen(function*() {
      builtAssetRoot('web');
      const http = yield* Effect.tryPromise(() => import('../http/index.ts'));
      return yield* serveWorkspaceView(options, info => ready({ ...info, ...http.viewAddresses(info.host, info.port) }));
    }).pipe(Effect.mapError(failure), Effect.provideContext(context)) });
  })),
  Layer.effect(LspLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<RuntimeEnvironment | Stdio.Stdio>();
    return LspLauncher.of({ serve: root => Effect.tryPromise(() => import('../lsp/index.ts')).pipe(Effect.flatMap(lsp => lsp.serveEditor(root)), Effect.mapError(failure), Effect.provideContext(context)) });
  })),
);

const validation = Layer.unwrap(loadApp().pipe(Effect.map(app => app.PublicationValidationLive)));
const cliServices = Layer.mergeAll(ServerRuntime.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), PersistentCache.layer, Publication.layer.pipe(Layer.provide(validation))).pipe(
  Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(cliPlatformLayer),
);
return launchers.pipe(Layer.merge(querySelection), Layer.merge(feedbackSelection), Layer.provideMerge(cliServices));
})));
}
export const cliLayer = /*#__PURE__*/ makeCliLayer();

/** Both the real startup adapter and captured invocations await this exact program. */
export const runCommand = <R>(command: Command.Command<any, any, any, any, R>, argv: readonly string[]) => Cache.withParseCache(Effect.scoped(Effect.gen(function*() {
  const Command = yield* Effect.tryPromise(() => import('effect/cli/Command'));
  yield* Layer.build(ProcessEventsLive);
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
    if (['init', 'template', 'herdr', 'doctor', 'server', 'schema'].includes(child.name)) return child;
    if (child.name === 'view') return child.pipe(Command.withSubcommands(child.subcommands.flatMap(group => group.commands.map(nested => nested.name === 'verify' ? nested : nested.pipe(Command.provideEffectDiscard(guard(true)))))));
    return child.pipe(Command.provideEffectDiscard(guard()));
  }));
  const guarded = command.pipe(Command.withSubcommands(commands)) as typeof command;
  // @concord-end
  const program = Command.runWith(guarded, { version, renderErrors: !argv.includes('--json') })(argv);
  if (argv.includes('--json')) {
    const console = yield* Console.Console;
    const CliError = yield* Effect.tryPromise(() => import('effect/cli/CliError'));
    const lines: unknown[][] = [];
    // Effect renders help before returning parse failures. Keep JSON errors atomic.
    yield* program.pipe(
      Effect.provideService(Console.Console, Object.assign(Object.create(console), { log: (...args: unknown[]) => { lines.push(args); } })),
      Effect.tapError(cause => Effect.sync(() => { if (CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0) lines.length = 0; })),
      Effect.ensuring(Effect.sync(() => { for (const args of lines) console.log(...args); })),
      Effect.catch(cliFailure),
    );
  } else yield* program.pipe(Effect.catch(cliFailure));
  return yield* (yield* CliInvocation).exitCode;
})).pipe(Effect.provide(cliLayer), Effect.provide(CliInvocation.layer(argv))));
