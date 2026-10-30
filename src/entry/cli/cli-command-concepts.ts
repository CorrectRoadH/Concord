// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { indexConcepts, setConcepts, showConcepts } from "../../app/index.js";
import { Option } from "effect";
import { Command } from "effect/unstable/cli";
import { text, optional, body, sync, expected } from "./cli-base.js";
import { withRepo } from "./cli-repository.js";

const concepts = Command.make('concepts').pipe(Command.withDescription('Discover and manage directory-owned concept catalogs.'), Command.withSubcommands([
  Command.make('index', {}, () => withRepo(repo => sync(() => indexConcepts(repo)), { readonly: true })),
  Command.make('show', { path: optional('path') }, args => withRepo(repo => sync(() => showConcepts(repo, Option.getOrUndefined(args.path))), { readonly: true })),
  Command.make('set', { path: optional('path'), body: text('body'), expectedDigest: text('expected-digest') }, args => withRepo((repo, settings) => sync(() => setConcepts(repo, body(args.body), expected(args.expectedDigest), settings.dryRun, Option.getOrUndefined(args.path))))).pipe(Command.withDescription('Replace a catalog with CAS. Use --expected-digest null only when creating a missing owner; --body accepts a Markdown file or -.')),
]));

export { concepts };
