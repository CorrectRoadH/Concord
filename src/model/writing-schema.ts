// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md#writingmd
import { Schema } from 'effect';
const Text = Schema.String.check(Schema.isPattern(/\S/u));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const Ban = Schema.Struct({ term: Text, use: Text, why: Text, roots: Schema.optional(Schema.Array(Text)), allowIn: Schema.optional(Schema.Array(Text)) });
export type BannedTerm = typeof Ban.Type;
export const WritingPolicySchema = Schema.Struct({ roots: Schema.optional(Schema.NonEmptyArray(Text)), bannedTerms: Schema.Array(Ban), sentenceLength: Schema.optional(PositiveInt), paragraphLength: Schema.optional(PositiveInt) });
export type WritingPolicy = typeof WritingPolicySchema.Type;
