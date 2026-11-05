// @concord-file
// @concord-implements docs/feature/local-sdlc/format.md#owner
import { Schema } from "effect";
import { stringify } from './markdown-dependencies.js';
import { FeedbackSourceSchema } from "./feedback-schema.js";
import { Text, decode, type DocumentMeta } from "./shared.js";

const NonEmpty = Text.check(Schema.isTrimmed());
const Path = NonEmpty.check(Schema.isPattern(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\r\n\0]+$/u));
const Spec = Path.check(Schema.isPattern(/^docs\/(?:feature|engineering)\/.+\.md(?:#[^\s#]+)?$/u));
const Memory = Path.check(Schema.isPattern(/^memory\/[^/#]+\.md$/u));
const Issue = Path.check(Schema.isPattern(/^docs\/issues\/[^/#]+\.md$/u));
const Relation = Schema.Union([
  Schema.Struct({ role: Schema.Literals(['investigation', 'root-cause']), target: Memory }),
  Schema.Struct({ role: Schema.Literal('adopts'), target: Spec }),
  Schema.Struct({ role: Schema.Literal('related'), target: Issue }),
]);
const MemoryRelation = Schema.Union([
  Schema.Struct({ role: Schema.Literal('supports'), target: Spec }),
]);
const Relations = Schema.NonEmptyArray(Relation).check(Schema.makeFilter(values => new Set(values.map(value => `${value.role}\0${value.target}`)).size === values.length));
const MemoryRelations = Schema.NonEmptyArray(MemoryRelation).check(Schema.makeFilter(values => new Set(values.map(value => `${value.role}\0${value.target}`)).size === values.length));

export const IssueFrontmatterSchema = Schema.Struct({ relations: Schema.optional(Relations), source: Schema.optional(FeedbackSourceSchema) });
export const MemoryFrontmatterSchema = Schema.Struct({ relations: Schema.optional(MemoryRelations) });

/** Only irreducible declarations are serialized; the other metadata is a projection. */
export function ownerFrontmatter(metadata: DocumentMeta): Record<string, unknown> | undefined {
  if (metadata.kind !== 'memory' && metadata.kind !== 'issue') return undefined;
  const fields = { ...(metadata.relations.length === 0 ? {} : { relations: metadata.relations }), ...(metadata.kind === 'issue' && metadata.source !== undefined ? { source: metadata.source } : {}) };
  if (Object.keys(fields).length === 0) return undefined;
  return metadata.kind === 'memory' ? decode(MemoryFrontmatterSchema, fields, metadata.id) : decode(IssueFrontmatterSchema, fields, metadata.id);
}

export function renderOwnerFrontmatter(metadata: DocumentMeta): string {
  const value = ownerFrontmatter(metadata);
  return value === undefined ? '' : `---\n${stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }).trimEnd()}\n---\n\n`;
}
