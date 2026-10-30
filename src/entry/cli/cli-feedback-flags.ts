// @concord-file
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { Option } from "effect";
import { Flag } from "effect/unstable/cli";
import { optional } from "./cli-base.js";

const feedbackFilters = {
  state: Flag.choice('state', ['open', 'closed']).pipe(Flag.optional),
  provider: Flag.choice('provider', ['local', 'github', 'linear']).pipe(Flag.optional),
  triage: Flag.choice('triage', ['pending', 'linked', 'closed']).pipe(Flag.optional),
  query: optional('query'),
};

const selectedFeedbackFilters = (args: { state: Option.Option<'open' | 'closed'>; provider: Option.Option<'local' | 'github' | 'linear'>; triage: Option.Option<'pending' | 'linked' | 'closed'>; query: Option.Option<string> }) => ({
  state: Option.getOrUndefined(args.state), provider: Option.getOrUndefined(args.provider), triage: Option.getOrUndefined(args.triage), query: Option.getOrUndefined(args.query),
});

export { feedbackFilters, selectedFeedbackFilters };
