// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { Installation } from '../../base/installation/index.js';
import { LspLauncher, ViewLauncher, ServerLauncher, PanelLauncher } from "./launchers.js";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive, Queries, executeQuery, mergeLocalFeedbackObservation, builtAssetRoot } from "../../app/index.js";
import { resourcePath } from "../../app/index.js";
import { readFileSync } from "node:fs";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { Command, CliError } from "effect/unstable/cli";
import { ConcordError, failure } from "../../model/index.js";
import { humanOutput } from "./presentation.js";
import { OwnedProcessLive } from "../../base/process/index.js";
import { Git } from '../../base/git/index.js';
import { Workspace } from '../../base/workspace/index.js';
import { Sources } from '../../base/sources/index.js';
import { Cache, CacheSnapshot, PersistentCache, FeedbackCacheWriter } from '../../base/cache/index.js';
import { ServerRuntime } from '../../base/server-lock/index.js';

const loadServer = () => Effect.tryPromise(() => import('../server/index.js'));

// Discovery needs only the base ports. Commands without an owner avoid loading
// the service's RPC, HTTP and computation entrypoints into their short lifetime.
const querySelection = Layer.unwrap(Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return Queries.Remote((root, request, cache = 'use') => Effect.gen(function*() {
    if (cache === 'off') return yield* executeQuery(root, request, cache);
    const location = yield* workspace.locate(root, true);
    const present = yield* Effect.try(() => runtime.read(location.privateDir)).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
    if (!present) return yield* executeQuery(root, request, cache);
    const server = yield* loadServer().pipe(Effect.mapError(failure));
    return yield* Effect.gen(function*() {
      return yield* (yield* Queries).execute(root, request, cache);
    }).pipe(Effect.provide(server.remoteQueriesLayer), Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime));
  }));
}));

const feedbackSelection = Layer.effect(FeedbackCacheWriter, Effect.gen(function*() {
  const workspace = yield* Workspace;
  const runtime = yield* ServerRuntime;
  return FeedbackCacheWriter.of({ merge: (root, connectionId, items) => Effect.gen(function*() {
    const location = yield* workspace.locate(root, true);
    const present = yield* Effect.try(() => runtime.read(location.privateDir)).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
    if (!present) return yield* mergeLocalFeedbackObservation(root, connectionId, items).pipe(Effect.provideService(Workspace, workspace));
    const server = yield* loadServer();
    return yield* Effect.gen(function*() {
      return yield* (yield* FeedbackCacheWriter).merge(root, connectionId, items);
    }).pipe(Effect.provide(server.feedbackWriterLayer), Effect.provideService(Workspace, workspace), Effect.provideService(ServerRuntime, runtime));
  }) });
}));

const launchers = Layer.mergeAll(
  Layer.effect(PanelLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Workspace | NodeServices.NodeServices | import('../../base/process/index.js').OwnedProcess>();
    return PanelLauncher.of({ serve: root => Effect.tryPromise(() => import('../panel/index.js')).pipe(Effect.flatMap(module => module.serveWorkspacePanel(root)), Effect.provideContext(context)) });
  })),
  Layer.effect(ServerLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices>();
    return ServerLauncher.of({
      run: root => loadServer().pipe(Effect.flatMap(server => server.serveWorkspace(root)), Effect.provideContext(context)),
      start: root => loadServer().pipe(Effect.flatMap(server => server.startWorkspaceServer(root)), Effect.provideContext(context)),
      stop: root => loadServer().pipe(Effect.flatMap(server => server.stopWorkspaceServer(root)), Effect.provideContext(context)),
      status: root => loadServer().pipe(Effect.flatMap(server => server.workspaceServerStatus(root)), Effect.provideContext(context)),
      projection: root => loadServer().pipe(Effect.flatMap(server => server.readExistingWorkspaceProjection(root)), Effect.provideContext(context)),
      clear: root => loadServer().pipe(Effect.flatMap(server => server.clearExistingWorkspaceCache(root)), Effect.provideContext(context)),
    });
  })),
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices>();
    return ViewLauncher.of({ serve: (options, ready) => Effect.gen(function*() {
      yield* Effect.try({ try: () => builtAssetRoot('web'), catch: failure });
      const server = yield* loadServer();
      const http = yield* Effect.tryPromise(() => import('../http/index.js'));
      return yield* server.serveWorkspaceView(options, info => ready({ ...info, ...http.viewAddresses(info.host, info.port) }));
    }).pipe(Effect.mapError(failure), Effect.provideContext(context)) });
  })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => Effect.tryPromise(() => import('../lsp/index.js')).pipe(Effect.flatMap(lsp => lsp.serveEditor(root)), Effect.mapError(failure)) })),
);

const cliServices = Layer.mergeAll(ServerRuntime.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), PersistentCache.layer, Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(
  Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer),
);
export const cliLayer = launchers.pipe(Layer.merge(querySelection), Layer.merge(feedbackSelection), Layer.provideMerge(cliServices));

export function runCli(command: Command.Command<any, any, any, any, Queries | PersistentCache | Installation | Workspace | Sources | Git | LspLauncher | ViewLauncher | ServerLauncher | PanelLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.js").OwnedProcess>): void {
 command.pipe(Command.run({version:Schema.decodeUnknownSync(Schema.Struct({version:Schema.String}))(JSON.parse(readFileSync(resourcePath('package.json'),'utf8'))).version,renderErrors:!process.argv.includes('--json')}),Effect.catch(cause=>Effect.sync(()=>{
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(cliLayer),NodeRuntime.runMain);

}
