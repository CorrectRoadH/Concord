// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
import { Command, Flag, Argument } from "effect/unstable/cli";
import { linkMemory } from "../../app/index.js";
import { activateMemory, supersedeMemory } from "../../app/index.js";
import { knowledgeIndex, knowledgeRecall } from "../../app/index.js";
import { text, id, sync } from "./cli-base.js";
import { withRepo, withReadRepo, withQuery } from "./cli-repository.js";

export const memory = Command.make('memory').pipe(Command.withDescription('Maintain Decision, Insight and Note relations and status.'), Command.withSubcommands([
  Command.make('index', {}, () => withQuery({ name: 'memory.index', input: {} })),
  Command.make('recall', { query: Argument.string('query') }, args => withQuery({ name: 'memory.recall', input: { query: args.query } })),
  Command.make('activate', { id, reason: text('reason') }, args => withRepo((repo,s) => sync(() => activateMemory(repo, args.id, args.reason, s.dryRun)))),
  Command.make('supersede', { id, replacement: text('replacement'), reason: text('reason') }, args => withRepo((repo,s) => sync(() => supersedeMemory(repo,args.id,args.replacement,args.reason,s.dryRun)))),
  Command.make('link', { id, target: text('target'), role: Flag.choice('role', ['supports', 'amends']).pipe(Flag.withDefault('supports')) }, args => withRepo((repo,s) => sync(() => linkMemory(repo,args.id,args.target,args.role,s.dryRun)))),
]));
