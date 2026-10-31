// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { Installation } from '../../base/installation/index.js';
import { LspLauncher, ViewLauncher } from "./launchers.js";
import { serveViewServer, viewAddresses } from "../http/index.js";
import { serveEditor } from "../lsp/index.js";
import { Publication } from "../../base/publication/index.js";
import { PublicationValidationLive } from "../../app/index.js";
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

const launchers = Layer.merge(
  Layer.effect(ViewLauncher, Effect.gen(function*() {
    const sources = yield* Sources;
    const workspace = yield* Workspace;
    const installation = yield* Installation;
    return ViewLauncher.of({ serve: (options, ready) => serveViewServer(options, server => ready({ root: server.root, host: server.host, port: server.port, address: server.address, ...viewAddresses(server.host, server.port) })).pipe(Effect.provideService(Sources, sources), Effect.provideService(Workspace, workspace), Effect.provideService(Installation, installation)) });
  })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => serveEditor(root) })),
);

const cliServices = Layer.mergeAll(Installation.layer, Workspace.layer, Sources.layer, Git.layer, Cache.layer, CacheSnapshot.layer(), PersistentCache.layer, Publication.layer.pipe(Layer.provide(PublicationValidationLive))).pipe(
  Layer.provideMerge(OwnedProcessLive), Layer.provideMerge(NodeServices.layer),
);
export const cliLayer = launchers.pipe(Layer.provideMerge(cliServices));

export function runCli(command: Command.Command<any, any, any, any, Installation | Workspace | Sources | Git | LspLauncher | ViewLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.js").OwnedProcess>): void {
 command.pipe(Command.run({version:Schema.decodeUnknownSync(Schema.Struct({version:Schema.String}))(JSON.parse(readFileSync(resourcePath('package.json'),'utf8'))).version,renderErrors:!process.argv.includes('--json')}),Effect.catch(cause=>Effect.sync(()=>{
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(cliLayer),NodeRuntime.runMain);

}
