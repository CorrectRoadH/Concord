// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#render
import { Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { renderReview } from "../../domain/trace/index.js";
import { optional, sync, cached } from "./cli-base.js";
import { withReadRepo } from "./cli-repository.js";

const review = Command.make('review').pipe(Command.withDescription('Generate local review material from current contracts and history.'),Command.withSubcommands([
  Command.make('render',{ref:Argument.string('reference').pipe(Argument.optional)},args=>withReadRepo((repo,s)=>sync(()=>renderReview(repo,Option.getOrUndefined(args.ref),cached(s.dryRun))), Option.isSome(args.ref) ? ['review', 'render', args.ref.value] : ['review', 'render'])),
]));

export { review };
