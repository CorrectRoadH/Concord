// @concord-file
// @concord-implements docs/feature/local-sdlc/library.md#owner
import { Schema } from 'effect';
import { stringify } from 'yaml';
import { FeedbackSourceSchema } from './feedback-schema.js';
import { IssueClosureSchema, IssueOriginSchema, SourceRecordSchema, Text, decode, type DocumentMeta } from './shared.js';

const NonEmpty = Text.check(Schema.isTrimmed());
const Path = NonEmpty.check(Schema.isPattern(/^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\r\n\0]+$/u));
const Relation = Schema.Struct({ role: Schema.Literals(['investigation', 'root-cause', 'decision', 'adopts', 'related']), target: Path });
const MemoryRelation = Schema.Struct({ role: Schema.Literals(['supports', 'amends']), target: Path });
const Relations = Schema.NonEmptyArray(Relation).check(Schema.makeFilter(values => new Set(values.map(value => `${value.role}\0${value.target}`)).size === values.length));
const MemoryRelations = Schema.NonEmptyArray(MemoryRelation).check(Schema.makeFilter(values => new Set(values.map(value => `${value.role}\0${value.target}`)).size === values.length));

export const IssueFrontmatterSchema = Schema.Struct({
  status: Schema.Literals(['open', 'closed']), relations: Schema.optional(Relations),
  source: Schema.optional(FeedbackSourceSchema), closure: Schema.optional(IssueClosureSchema),
  origin: Schema.optional(IssueOriginSchema), subject: Schema.optional(Schema.Literals(['product', 'repository', 'dependency'])),
  claim: Schema.optional(Schema.Literals(['defect', 'friction', 'request'])), observation: Schema.optional(NonEmpty), impact: Schema.optional(NonEmpty),
});
export const MemoryFrontmatterSchema = Schema.Struct({
  type: Schema.Literals(['decision', 'insight', 'note']), status: Schema.Literals(['captured', 'current', 'superseded']),
  relations: Schema.optional(MemoryRelations), supersededBy: Schema.optional(Path),
  supersession: Schema.optional(Schema.Struct({ statement: NonEmpty, source: SourceRecordSchema })),
}).check(Schema.makeFilter(value => value.type !== 'note' || value.status === 'captured', { message: 'Note Memory must remain captured' }),
  Schema.makeFilter(value => value.supersededBy === undefined || value.supersession === undefined, { message: 'Choose supersededBy or supersession' }));

/** Only irreducible declarations are serialized; the other metadata is a projection. */
export function ownerFrontmatter(metadata: DocumentMeta): Record<string, unknown> | undefined {
  if (metadata.kind === 'memory') {
    return decode(MemoryFrontmatterSchema, {
      type: metadata.memoryKind, status: metadata.state,
      ...(metadata.promotions.length === 0 ? {} : { relations: metadata.promotions.map(target => ({ role: target.startsWith('docs/constitution.md#') ? 'amends' : 'supports', target })) }),
      ...(metadata.supersededBy === undefined ? {} : { supersededBy: metadata.supersededBy }),
      ...(metadata.supersession === undefined ? {} : { supersession: metadata.supersession }),
    }, metadata.id);
  }
  if (metadata.kind !== 'issue') return undefined;
  const relations = [...metadata.memoryRelations.map(item => ({ role: item.kind, target: item.memory })), ...metadata.adoptions.current.map(target => ({ role: 'adopts', target }))];
  return decode(IssueFrontmatterSchema, {
    status: metadata.state === 'draft' ? 'open' : metadata.state,
    ...(relations.length === 0 ? {} : { relations }),
    ...Object.fromEntries(['source', 'closure', 'origin', 'subject', 'claim', 'observation', 'impact'].flatMap(key => {
      const value = metadata[key as keyof typeof metadata]; return value === undefined ? [] : [[key, value]];
    })),
  }, metadata.id);
}

export function renderOwnerFrontmatter(metadata: DocumentMeta): string {
  const value = ownerFrontmatter(metadata);
  return value === undefined ? '' : `---\n${stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }).trimEnd()}\n---\n\n`;
}
