import { Schema } from "effect";
export const FeedbackEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal("concord.feedback-envelope/v1"),
  origin: Schema.Struct({ repository: Schema.NonEmptyString, originId: Schema.NonEmptyString, commit: Schema.NonEmptyString }),
  candidate: Schema.optional(Schema.Struct({ version: Schema.optional(Schema.NonEmptyString), commit: Schema.optional(Schema.NonEmptyString), sha256: Schema.optional(Schema.NonEmptyString) })),
  source: Schema.Literal("dogfood"), observation: Schema.NonEmptyString, impact: Schema.NonEmptyString,
  artifacts: Schema.Array(Schema.Struct({ path: Schema.NonEmptyString, byteLength: Schema.Natural, sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })), digest: Schema.NonEmptyString,
});
export type FeedbackEnvelopeV1 = typeof FeedbackEnvelopeV1Schema.Type;
