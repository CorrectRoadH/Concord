// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { Installation } from '../../base/installation/index.js';
import { LspLauncher, ViewLauncher, ServerLauncher, PanelLauncher } from "./launchers.js";
import { serveWorkspace, startWorkspaceServer, stopWorkspaceServer, workspaceServerStatus, remoteQueriesLayer, feedbackWriterLayer, serveWorkspaceView, readExistingWorkspaceProjection } from '../server/index.js';
import { viewAddresses } from "../http/index.js";
import { serveEditor } from "../lsp/index.js";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive, Queries } from "../../app/index.js";
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
import { Cache, CacheSnapshot, PersistentCache } from '../../base/cache/index.js';
import { ServerRuntime } from '../../base/server-lock/index.js';

const launchers = Layer.mergeAll(
  Layer.effect(PanelLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Workspace | NodeServices.NodeServices | import('../../base/process/index.js').OwnedProcess>();
    return PanelLauncher.of({ serve: root => Effect.tryPromise(() => import('../panel/index.js')).pipe(Effect.flatMap(module => module.serveWorkspacePanel(root)), Effect.provideContext(context)) });
  })),
  Layer.effect(ServerLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices>();
    return ServerLauncher.of({ run: root => serveWorkspace(root).pipe(Effect.provideContext(context)), start: root => startWorkspaceServer(root).pipe(Effect.provideContext(context)), stop: root => stopWorkspaceServer(root).pipe(Effect.provideContext(context)), status: root => workspaceServerStatus(root).pipe(Effect.provideContext(context)), projection: root => readExistingWorkspaceProjection(root).pipe(Effect.provideContext(context)) });
  })),
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const context = yield* Effect.context<ServerRuntime | Installation | Workspace | Sources | PersistentCache | NodeServices.NodeServices>();
    return ViewLauncher.of({ serve: (options, ready) => serveWorkspaceView(options, server => ready({ ...server, ...viewAddresses(server.host, server.port) })).pipe(Effect.provideContext(context)) });
  })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => serveEditor(root) })),
);

const cliServices = Layer.mergeAll(ServerRuntime.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), PersistentCache.layer, Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(
  Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer),
);
export const cliLayer = launchers.pipe(Layer.merge(remoteQueriesLayer), Layer.merge(feedbackWriterLayer), Layer.provideMerge(cliServices));

export function runCli(command: Command.Command<any, any, any, any, Queries | PersistentCache | Installation | Workspace | Sources | Git | LspLauncher | ViewLauncher | ServerLauncher | PanelLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.js").OwnedProcess>): void {
 command.pipe(Command.run({version:Schema.decodeUnknownSync(Schema.Struct({version:Schema.String}))(JSON.parse(readFileSync(resourcePath('package.json'),'utf8'))).version,renderErrors:!process.argv.includes('--json')}),Effect.catch(cause=>Effect.sync(()=>{
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(cliLayer),NodeRuntime.runMain);

}
