import { Schema } from 'effect';

const Text = Schema.String.check(Schema.isMinLength(1));
const DateText = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u));
const Amendment = Schema.Struct({ date: DateText, reason: Text, sources: Schema.Array(Text), impact: Text });
const fields = {
  status: Schema.Literals(['draft', 'active']),
  ratifiedAt: Schema.NullOr(DateText), amendedAt: DateText, amendments: Schema.Array(Amendment),
};

export const ConstitutionSchema = Schema.Struct({ format: Schema.Literal('concord.constitution/v2'), ...fields });
/** Read only by `constitution migrate`; ordinary runtime paths reject v1. */
export const LegacyConstitutionSchema = Schema.Struct({ format: Schema.Literal('concord.constitution/v1'), ...fields });

export type ConstitutionMeta = typeof ConstitutionSchema.Type;
