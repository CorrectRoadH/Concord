// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/review-local-changes.md
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { getGitDiff, getGitStatus } from "../../app/index.ts";
import { root, emit, sync, viewRoot } from "./cli-base.ts";

const gitView = Command.make('git').pipe(Command.withDescription('Inspect readonly working-tree status and diffs.'), Command.withSubcommands([
  Command.make('status', {}, () => Effect.gen(function*() { const settings = yield* root; const result = yield* getGitStatus((yield* viewRoot(settings))); yield* emit(result, settings.json); })),
  Command.make('diff', { path: Argument.string('path'), area: Flag.choice('area', ['staged', 'unstaged', 'untracked']) }, args => Effect.gen(function*() { const settings = yield* root; const result = yield* getGitDiff((yield* viewRoot(settings)), args.path, args.area); yield* emit(result, settings.json); })),
]));

export { gitView };
