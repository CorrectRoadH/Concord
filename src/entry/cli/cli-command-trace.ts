// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#check
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#show
// @concord-implements docs/feature/local-sdlc/use-case/inspect-relationship-gaps.md#list-gaps
import { Argument, Command } from "effect/unstable/cli";
import { buildTrace } from "../../app/index.js";
import { traceGaps, traceShow } from "../../app/index.js";
import { sync, cached } from "./cli-base.js";
import { withReadRepo, withQuery } from "./cli-repository.js";

const trace = Command.make('trace').pipe(Command.withDescription('Derive forward and reverse relationships from current owners.'),Command.withSubcommands([
  Command.make('show',{ref:Argument.string('reference')},args=>withReadRepo((repo,s)=>sync(()=>traceShow(repo,args.ref,cached(s.dryRun))), ['trace', 'show', args.ref])),
  Command.make('gaps',{},()=>withReadRepo((repo,s)=>sync(()=>traceGaps(repo,cached(s.dryRun))), ['trace', 'gaps'])).pipe(Command.withDescription('List contracts and documented CLI pages missing explicit code or active test relationships; this is not coverage.')),
  Command.make('check',{},()=>withQuery({ name: 'trace.check', input: {} })),
]));

export { trace };
