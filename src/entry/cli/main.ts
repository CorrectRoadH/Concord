// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
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

const launchers = Layer.merge(
  Layer.succeed(ViewLauncher, ViewLauncher.of({ serve: (options, ready) => serveViewServer(options, server => ready({ root: server.root, host: server.host, port: server.port, address: server.address, ...viewAddresses(server.host, server.port) })) })),
  Layer.succeed(LspLauncher, LspLauncher.of({ serve: root => serveEditor(root) })),
);

export function runCli(command: Command.Command<any, any, any, any, LspLauncher | ViewLauncher | Publication | NodeServices.NodeServices | import("../../base/process/index.js").OwnedProcess>): void {
 command.pipe(Command.run({version:Schema.decodeUnknownSync(Schema.Struct({version:Schema.String}))(JSON.parse(readFileSync(resourcePath('package.json'),'utf8'))).version,renderErrors:!process.argv.includes('--json')}),Effect.catch(cause=>Effect.sync(()=>{
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(Publication.layer.pipe(Layer.provide(PublicationValidationLive))),Effect.provide(launchers),Effect.provide(NodeServices.layer),Effect.provide(OwnedProcessLive),NodeRuntime.runMain);

}
