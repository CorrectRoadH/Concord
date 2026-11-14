// @concord-file
// @concord-implements docs/feature/local-data-engine/data-model.md
import { Schema } from 'effect';
export const KnowledgeKind = Schema.Literals(['memory', 'issue']);
export type KnowledgeKind = typeof KnowledgeKind.Type;
const fields = { path: Schema.String, id: Schema.String, title: Schema.String, body: Schema.String, digest: Schema.String, searchText: Schema.String };
const strict = <S extends Schema.Top>(schema: S) => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
export const KnowledgeDocument = Schema.Union([
  strict(Schema.Struct(fields)),
  strict(Schema.Struct({ ...fields, provider: Schema.Literals(['local', 'github', 'linear']) })),
]);
export type KnowledgeDocument = typeof KnowledgeDocument.Type;
export const KnowledgeGeneration = strict(Schema.Struct({ kind: KnowledgeKind, generation: Schema.String, definitionDigest: Schema.String, sourceDigest: Schema.String, documentCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), logicalBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }));
export type KnowledgeGeneration = typeof KnowledgeGeneration.Type;
export const KnowledgeUpdate = strict(Schema.Struct({ generation: KnowledgeGeneration, previous: Schema.NullOr(Schema.String), documents: Schema.Array(KnowledgeDocument), removed: Schema.Array(Schema.String) }));
export type KnowledgeUpdate = typeof KnowledgeUpdate.Type;
export const KnowledgeResult = strict(Schema.Struct({ generation: KnowledgeGeneration, documents: Schema.Array(KnowledgeDocument) }));
export type KnowledgeResult = typeof KnowledgeResult.Type;
