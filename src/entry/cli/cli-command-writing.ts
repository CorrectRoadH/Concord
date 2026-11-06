// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-writing.md
import { checkWriting } from "../../app/index.ts";
import { showWriting, writingIndex } from "../../app/index.ts";
import { readWritingPolicy } from "../../app/index.ts";
import { Option } from "effect";
import { Command } from "effect/unstable/cli";
import { text, optional, body, sync, expected } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";

const writing = Command.make('writing').pipe(Command.withDescription('Discover and manage directory-owned writing policies.'), Command.withSubcommands([
  Command.make('index', {}, () => withQuery({ name: 'writing.index', input: {} })),
  Command.make('show', { path: optional('path') }, args => withQuery({ name: 'writing.show', input: { path: Option.getOrUndefined(args.path) } })),
  Command.make('check', { path: optional('path') }, args => withRepo((repo, settings) => sync(() => { const result = checkWriting(repo, Option.getOrUndefined(args.path), !settings.dryRun); if (!result.ok) process.exitCode = 1; return result; }), { readonly: true })),
]));

export { writing };
