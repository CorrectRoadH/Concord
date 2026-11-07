// @concord-file
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { Option } from "effect";
import { Flag } from "effect/cli";
import { optional } from "./cli-base.ts";

const feedbackFilters = {
  provider: Flag.Literals('provider', ['local', 'github', 'linear']).pipe(Flag.optional),
  triage: Flag.Literals('triage', ['pending', 'linked']).pipe(Flag.optional),
  query: optional('query'),
};

const selectedFeedbackFilters = (args: { provider: Option.Option<'local' | 'github' | 'linear'>; triage: Option.Option<'pending' | 'linked'>; query: Option.Option<string> }) => ({
  provider: Option.getOrUndefined(args.provider), triage: Option.getOrUndefined(args.triage), query: Option.getOrUndefined(args.query),
});

export { feedbackFilters, selectedFeedbackFilters };
