// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { Option } from "effect";
import { Command } from "effect/cli";
import { text, optional, body, sync, expected } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";

const concepts = Command.make('concepts').pipe(Command.withDescription('Discover and manage directory-owned concept catalogs.'), Command.withSubcommands([
  Command.make('index', {}, () => withQuery({ name: 'concepts.index', input: {} })),
  Command.make('show', { path: optional('path') }, args => withQuery({ name: 'concepts.show', input: { path: Option.getOrUndefined(args.path) } })),
]));

export { concepts };
