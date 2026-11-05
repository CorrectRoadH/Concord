// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
import { Schema } from 'effect';
import { ProjectSchema } from './shared.js';

export const WritingGuideSchema = Schema.Literals(['docs-from-scratch', 'docs-from-code']);
export type WritingGuide = typeof WritingGuideSchema.Type;
export const InitializationReceiptSchema = Schema.Struct({
  operation: Schema.Literal('init'),
  dryRun: Schema.Boolean,
  changedPaths: Schema.Array(Schema.String),
  recoveryRequired: Schema.optional(Schema.Boolean),
  config: ProjectSchema,
  createdPaths: Schema.Array(Schema.String),
  preservedPaths: Schema.Array(Schema.String),
  guide: WritingGuideSchema,
});
export type InitializationReceipt = typeof InitializationReceiptSchema.Type;
