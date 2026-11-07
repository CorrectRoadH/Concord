// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/review-traceability.md#render
import { Option } from "effect";
import { Argument, Command } from "effect/cli";
import { renderReview } from "../../app/index.ts";
import { optional, sync, cached } from "./cli-base.ts";
import { withReadRepo } from "./cli-repository.ts";

const review = Command.make('review', { ref: Argument.String('reference').pipe(Argument.optional) }, args =>
  withReadRepo((repo, settings) => sync(() => renderReview(repo, Option.getOrUndefined(args.ref), cached(settings.dryRun))),
    Option.isSome(args.ref) ? ['review', args.ref.value] : ['review'])
).pipe(Command.withDescription('Generate local review material from current contracts and history; optionally select one Feature.'));

export { review };
