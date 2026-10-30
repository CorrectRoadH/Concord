// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { resourcePath } from "../../base/installation/index.js";
import { readFileSync } from "node:fs";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { Command, CliError } from "effect/unstable/cli";
import { ConcordError, failure } from "../../model/index.js";
import { humanOutput } from "./presentation.js";
import { OwnedProcessLive } from "../../base/process/index.js";

export function runCli(command: Command.Command<any, any, any, any, NodeServices.NodeServices | import("../../base/process/owned-process.js").OwnedProcess>): void {
 command.pipe(Command.run({version:Schema.decodeUnknownSync(Schema.Struct({version:Schema.String}))(JSON.parse(readFileSync(resourcePath('package.json'),'utf8'))).version,renderErrors:!process.argv.includes('--json')}),Effect.catch(cause=>Effect.sync(()=>{
  const error=CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = {ok:false,error:error.code,message:error.message,...(error.code === 'WritingBudgetExceeded' ? {complete:false} : {}),...(error.details===undefined?{}:{details:error.details})};
  process.stderr.write(`${process.argv.includes('--json') ? JSON.stringify(result) : humanOutput(result)}\n`);process.exitCode=1;
})),Effect.provide(NodeServices.layer),Effect.provide(OwnedProcessLive),NodeRuntime.runMain);

}
