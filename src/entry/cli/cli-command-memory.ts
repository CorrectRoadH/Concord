// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
import { Command, Argument } from "effect/unstable/cli";
import { linkMemory } from "../../app/index.ts";
import { text, id, sync } from "./cli-base.ts";
import { withRepo, withQuery } from "./cli-repository.ts";
export const memory = Command.make('memory').pipe(Command.withDescription('Search reusable experience and link it to Spec.'), Command.withSubcommands([
  Command.make('search', { query: Argument.string('query') }, args => withQuery({ name: 'memory.search', input: { query: args.query } })),
  Command.make('link', { id, target: Argument.string('target') }, args => withRepo((repo,s) => sync(() => linkMemory(repo,args.id,args.target,'supports',s.dryRun)))),
]));
