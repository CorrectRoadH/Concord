// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-writing.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { Schema } from 'effect';

const Text = Schema.String.check(Schema.isPattern(/\S/u));
const Paths = Schema.Array(Text);
const Ban = Schema.Struct({
  term: Text, use: Text, why: Text,
  roots: Schema.optional(Paths), exempt: Schema.optional(Paths), allowIn: Schema.optional(Schema.Array(Text)),
});
export type BannedTerm = typeof Ban.Type;
export const WritingPolicySchema = Schema.Struct({
  format: Schema.Literal('concord.writing/v2'),
  roots: Schema.optional(Schema.NonEmptyArray(Text)),
  bannedTerms: Schema.Array(Ban),
  sentenceLength: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
  paragraphLength: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0)))),
  unusedConcepts: Schema.optional(Schema.Boolean),
});
export type WritingPolicy = typeof WritingPolicySchema.Type;
