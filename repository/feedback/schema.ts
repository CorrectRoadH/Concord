import { Schema } from "effect";
import { IssueAdoptionsSchema, IssueClosureSchema, IssueMemoryRelationSchema, IssueSchema, type IssueClosure, type IssueMemoryRelation, type IssueMeta } from "concord-sdlc/model";

export const FeedbackMemoryRelationSchema = IssueMemoryRelationSchema;
export const FeedbackClosureSchema = IssueClosureSchema;
export const FeedbackAdoptionsSchema = IssueAdoptionsSchema;
export const FeedbackIssueSchema = IssueSchema;
export type FeedbackMemoryRelation = IssueMemoryRelation;
export type FeedbackClosure = IssueClosure;
export type FeedbackAdoptions = typeof IssueAdoptionsSchema.Type;
export type FeedbackDocumentMetadata = IssueMeta;
export const FEEDBACK_MEMORY_RELATION_KINDS = ["investigation", "root-cause", "decision", "delivery"] as const;
export const FEEDBACK_CLOSURE_KINDS = ["fixed", "delivered", "duplicate", "declined", "invalid", "external-fixed", "closed"] as const;

export const FeedbackEnvelopeV1Schema = Schema.Struct({
  format: Schema.Literal("concord.feedback-envelope/v1"),
  origin: Schema.Struct({ repository: Schema.NonEmptyString, originId: Schema.NonEmptyString, commit: Schema.NonEmptyString }),
  candidate: Schema.optional(Schema.Struct({ version: Schema.optional(Schema.NonEmptyString), commit: Schema.optional(Schema.NonEmptyString), sha256: Schema.optional(Schema.NonEmptyString) })),
  source: Schema.Literal("dogfood"), observation: Schema.NonEmptyString, impact: Schema.NonEmptyString,
  artifacts: Schema.Array(Schema.Struct({ path: Schema.NonEmptyString, byteLength: Schema.Natural, sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) })), digest: Schema.NonEmptyString,
});
export type FeedbackEnvelopeV1 = typeof FeedbackEnvelopeV1Schema.Type;
