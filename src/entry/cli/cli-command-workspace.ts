// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md
// @concord-implements docs/feature/local-data-engine/cli.md#等待下一份结果
import { Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { applicationRuntime, getWorkspaceSnapshot, validateViewRoot } from "../../app/index.ts";
import { readWorkspaceProjection, workspaceProjectionContext } from "../../app/index.ts";
import { root, emit, optional, viewRoot } from "./cli-base.ts";
import { ServerLauncher, QueryServerMode } from './launchers.ts';
import { withQuery } from './cli-repository.ts';

const workspace = Command.make('workspace').pipe(Command.withDescription('Inspect the shared human/agent workspace projection.'), Command.withSubcommands([
  Command.make('show', {}, () => withQuery({ name: 'workspace.show', input: {} })),
  Command.make('projection', {}, () => Effect.gen(function*() { const settings = yield* root; const path = validateViewRoot((yield* viewRoot(settings)), yield* applicationRuntime); const remote = settings.dryRun ? undefined : yield* (yield* ServerLauncher).projection(path).pipe(Effect.provideService(QueryServerMode, settings.server)); const result = remote ?? (yield* readWorkspaceProjection(yield* workspaceProjectionContext(path))); yield* emit({ operation: 'workspace-projection', ...result }, settings.json); })),
  Command.make('wait', { after: optional('after'), timeout: Flag.Int('timeout').pipe(Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(120))), Flag.withDefault(25)) }, args => Effect.gen(function*() {
    const settings = yield* root;
    const result = yield* (yield* ServerLauncher).wait(yield* viewRoot(settings), Option.getOrUndefined(args.after), args.timeout).pipe(Effect.provideService(QueryServerMode, settings.server));
    yield* emit(result, settings.json);
  })).pipe(Command.withDescription('Wait for the workspace service to accept a different source digest.')),
]));

export { workspace };
