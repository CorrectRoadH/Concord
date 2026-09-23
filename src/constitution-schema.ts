import { Schema } from 'effect';

const Text = Schema.String.check(Schema.isMinLength(1));
const DateText = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const Version = Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u));
const Amendment = Schema.Struct({ date: DateText, reason: Text, sources: Schema.Array(Text), impact: Text });

export const ConstitutionSchema = Schema.Struct({
  format: Schema.Literal('concord.constitution/v1'), status: Schema.Literals(['draft', 'active']),
  ratifiedAt: Schema.NullOr(DateText), amendedAt: DateText, amendments: Schema.Array(Amendment),
});

/** Read-only compatibility with constitutions created before versions were removed. */
export const LegacyConstitutionSchema = Schema.Struct({
  format: Schema.Literal('concord.constitution/v1'), status: Schema.Literals(['draft', 'active']), version: Version,
  ratifiedAt: Schema.NullOr(DateText), amendedAt: DateText,
  amendments: Schema.Array(Schema.Struct({ version: Version, date: DateText, reason: Text, sources: Schema.Array(Text), impact: Text })),
});

export type ConstitutionMeta = typeof ConstitutionSchema.Type;
