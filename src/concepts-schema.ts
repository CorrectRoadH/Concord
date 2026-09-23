// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { Schema } from 'effect';
import { Slug } from './shared.js';

const Nonblank = Schema.String.check(Schema.isPattern(/\S/u));
export const ConceptNamesSchema = Schema.Struct({
  preferred: Nonblank,
  aliases: Schema.optional(Schema.Array(Nonblank)),
  deprecated: Schema.optional(Schema.Array(Nonblank)),
});
export const ConceptDefinitionSchema = Schema.Struct({
  id: Slug,
  definition: Nonblank,
  names: Schema.Record(Schema.String.check(Schema.isPattern(/\S/u)), ConceptNamesSchema),
});
export const ConceptCatalogSchema = Schema.Struct({
  format: Schema.Literal('concord.concepts/v1'),
  concepts: Schema.Array(ConceptDefinitionSchema),
  imports: Schema.optional(Schema.Array(Nonblank)),
});
export type ConceptDefinition = typeof ConceptDefinitionSchema.Type;
export type ConceptCatalog = typeof ConceptCatalogSchema.Type;
