import { Schema } from 'effect';

/** Current rules; adoption and amendment reasons belong to Decision Memory. */
export const ConstitutionSchema = Schema.Struct({ format: Schema.Literal('concord.constitution/v3'), status: Schema.Literals(['draft', 'active']) });
export type ConstitutionMeta = typeof ConstitutionSchema.Type;
