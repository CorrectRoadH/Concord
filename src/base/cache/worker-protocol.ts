// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#worker-requests
import { Schema } from 'effect';
import { CacheDerivationBatch, RemoteFeedbackSchema } from '../../model/index.ts';
import { HawdbEntry, HawdbFailureCode, HawdbNamespace } from './hawdb-types.ts';
import { KnowledgeKind, KnowledgeResult, KnowledgeUpdate } from './knowledge-search-model.ts';
const strict = <S extends Schema.Top>(schema: S) => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
const operation = <const Name extends string, Fields extends Schema.Struct.Fields>(op: Name, fields: Fields) => strict(Schema.Struct({ op: Schema.Literal(op), ...fields }));
export const DatabaseOperation = Schema.Union([
  operation('open', { privateDir: Schema.NullOr(Schema.String), runtime: strict(Schema.Struct({ cwd: Schema.String, env: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String)) })) }),
  operation('read', { namespace: HawdbNamespace, keys: Schema.optional(Schema.Array(Schema.String)) }),
  operation('compare', { namespace: HawdbNamespace, key: Schema.String, expected: Schema.NullOr(Schema.String), payload: Schema.String }),
  operation('derived', { batches: Schema.Array(CacheDerivationBatch) }),
  operation('feedback', { connectionId: Schema.String, items: Schema.Array(RemoteFeedbackSchema) }),
  operation('snapshot', {}), operation('status', {}), operation('clear', {}), operation('close', {}),
  operation('search', { memory: Schema.Boolean, kind: KnowledgeKind, generation: Schema.String, terms: Schema.Array(Schema.String), update: Schema.optional(KnowledgeUpdate) }),
  operation('discard-search', { memory: Schema.Boolean, kind: KnowledgeKind }),
]);
export type DatabaseOperation = typeof DatabaseOperation.Type;
export const DatabaseRequest = strict(Schema.Struct({ workerId: Schema.String, id: Schema.Int, deadline: Schema.BigInt, control: Schema.instanceOf(SharedArrayBuffer), operation: DatabaseOperation }));
export type DatabaseRequest = typeof DatabaseRequest.Type;
export const DatabaseClear = strict(Schema.Struct({ status: Schema.Literals(['empty', 'cleared']), path: Schema.String }));
export const DatabaseSnapshot = strict(Schema.Struct({ annotation_cache: Schema.Array(HawdbEntry), code_cache: Schema.Array(HawdbEntry), config_cache: Schema.Array(HawdbEntry), feedback_cache: Schema.Array(HawdbEntry), query_cache: Schema.Array(HawdbEntry) }));
export const DatabaseStatus = strict(Schema.Struct({ status: Schema.String, path: Schema.String, physicalBytes: Schema.NullOr(Schema.Number), detail: Schema.optional(Schema.String), sourceDigest: Schema.optional(Schema.String) }));
export const DatabaseValue = Schema.Union([
  Schema.Null, Schema.Boolean, Schema.Array(HawdbEntry), Schema.Array(Schema.String), KnowledgeResult, DatabaseClear, DatabaseSnapshot, DatabaseStatus,
]);
export type DatabaseValue = typeof DatabaseValue.Type;
export const DatabaseReply = strict(Schema.Struct({ workerId: Schema.String, id: Schema.Int, outcome: Schema.Union([
  strict(Schema.Struct({ ok: Schema.Literal(true), value: DatabaseValue })),
  strict(Schema.Struct({ ok: Schema.Literal(false), code: HawdbFailureCode, message: Schema.String })),
]) }));
export type DatabaseReply = typeof DatabaseReply.Type;
