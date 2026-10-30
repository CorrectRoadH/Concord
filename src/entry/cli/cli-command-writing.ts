// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-writing.md
import { checkWriting } from "../../app/index.js";
import { showWriting, setWriting, writingIndex } from "../../app/index.js";
import { readWritingPolicy } from "../../app/index.js";
import { Option } from "effect";
import { Command } from "effect/unstable/cli";
import { text, optional, body, sync, expected } from "./cli-base.js";
import { withRepo } from "./cli-repository.js";

const writing = Command.make('writing').pipe(Command.withDescription('Discover and manage directory-owned writing policies.'), Command.withSubcommands([
  Command.make('index', {}, () => withRepo(repo => sync(() => writingIndex(repo)), { readonly: true })),
  Command.make('show', { path: optional('path') }, args => withRepo(repo => sync(() => showWriting(repo, Option.getOrUndefined(args.path))), { readonly: true })),
  Command.make('set', { path: optional('path'), body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => setWriting(repo, readWritingPolicy(body(args.body), Option.getOrUndefined(args.path)), expected(args.expectedDigest), settings.dryRun, Option.getOrUndefined(args.path))))).pipe(Command.withDescription('Replace a policy with CAS. Use --expected-digest null only when creating a missing owner; --body accepts a JSON file or -.')),
  Command.make('check', { path: optional('path') }, args => withRepo((repo, settings) => sync(() => { const result = checkWriting(repo, Option.getOrUndefined(args.path), !settings.dryRun); if (!result.ok) process.exitCode = 1; return result; }), { readonly: true })),
]));

export { writing };
