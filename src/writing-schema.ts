// @concord-file
// @concord-implements docs/feature/documentation-quality/policy.md#写作政策
// @concord-implements docs/feature/documentation-quality/policy.md#受控写作规则
import { Schema } from 'effect';

const Text = Schema.String.check(Schema.isPattern(/\S/u));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const clear = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema));
const Paths = Schema.Array(Text);
const Ban = Schema.Struct({
  term: Text, use: Text, why: Text,
  roots: Schema.optional(Paths), exempt: Schema.optional(Paths), allowIn: Schema.optional(Schema.Array(Text)),
});
export type BannedTerm = typeof Ban.Type;
const tables = <S extends Schema.Top>(schema: S) => Schema.Struct({ zh: clear(schema), en: clear(schema) });
const Phrases = Schema.Array(Text);
const AllowIn = clear(tables(Phrases));
const Limits = Schema.Struct({ procedural: clear(PositiveInt), descriptive: clear(PositiveInt) });
export const ControlledSchema = Schema.Struct({
  language: clear(Schema.Literals(['auto', 'zh', 'en'])),
  sentence: clear(tables(Limits)),
  paragraphSentences: clear(PositiveInt),
  procedural: clear(Schema.Struct({
    singleInstruction: clear(Schema.Boolean), requireVerb: clear(Schema.Boolean),
    verbs: clear(Schema.Struct({ zh: clear(Schema.Array(Text)), en: clear(Schema.Array(Schema.Struct({ lemma: Text, forms: Schema.optional(Schema.Array(Text)) }))) })),
    allowIn: AllowIn,
  })),
  approvedWords: clear(Schema.Struct({ enabled: clear(Schema.Boolean), en: clear(Schema.Array(Text)), allowIn: AllowIn })),
  passiveVoice: clear(Schema.Struct({ zh: clear(Schema.Boolean), en: clear(Schema.Boolean), participles: clear(Schema.Array(Text)), allowIn: AllowIn })),
});
const Legacy = {
  roots: Schema.optional(Schema.NonEmptyArray(Text)), bannedTerms: Schema.Array(Ban),
  sentenceLength: clear(PositiveInt), paragraphLength: clear(PositiveInt), unusedConcepts: Schema.optional(Schema.Boolean),
};
export const WritingPolicyV2Schema = Schema.Struct({ format: Schema.Literal('concord.writing/v2'), ...Legacy });
export const WritingPolicySchema = Schema.Struct({ format: Schema.Literal('concord.writing/v3'), ...Legacy, controlled: clear(ControlledSchema) });
export type WritingPolicy = typeof WritingPolicySchema.Type;
export type Controlled = typeof ControlledSchema.Type;
