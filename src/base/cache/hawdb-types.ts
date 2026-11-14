// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#原生边界
import { Schema } from 'effect';
export const HawdbNamespace = Schema.Literals(['document_parse', 'code_parse', 'git_baseline', 'annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache', 'workspace_projection']);
export type HawdbNamespace = typeof HawdbNamespace.Type;
export const HawdbEntry = Schema.Struct({ key: Schema.String, payload: Schema.String });
export type HawdbEntry = typeof HawdbEntry.Type;
export const HawdbLimits = Schema.Struct({ maxEntries: Schema.Int, maxBytes: Schema.Int });
export type HawdbLimits = typeof HawdbLimits.Type;
export const HawdbFailureCode = Schema.Literals(['HawdbBusy', 'HawdbUnavailable', 'HawdbIncompatible', 'HawdbCacheSchemaMismatch', 'HawdbLimit', 'HawdbClosed', 'HawdbCommitUnknown', 'HawdbCancelled', 'UnsafePath']);
export type HawdbFailureCode = typeof HawdbFailureCode.Type;
export class HawdbFailure extends Schema.TaggedError<HawdbFailure>()('HawdbFailure', {
  code: HawdbFailureCode, message: Schema.String,
}) {
  constructor(code: HawdbFailureCode, message: string, options?: ErrorOptions) { super({ code, message }); if (options) this.cause = options.cause; }
}
export const MIB = 1024 * 1024;
export const memoryNamespaces = ['document_parse', 'code_parse', 'git_baseline'] as const;
export const persistentNamespaces = ['annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache', 'workspace_projection'] as const;
export const quotas: Readonly<Record<HawdbNamespace, HawdbLimits>> = {
  document_parse: { maxEntries: 10000, maxBytes: 16 * MIB }, code_parse: { maxEntries: 10000, maxBytes: 16 * MIB }, git_baseline: { maxEntries: 128, maxBytes: 4 * MIB },
  annotation_cache: { maxEntries: 64, maxBytes: 24 * MIB }, code_cache: { maxEntries: 20000, maxBytes: 32 * MIB }, config_cache: { maxEntries: 128, maxBytes: 8 * MIB },
  feedback_cache: { maxEntries: 10000, maxBytes: 32 * MIB }, query_cache: { maxEntries: 64, maxBytes: 16 * MIB }, workspace_projection: { maxEntries: 1, maxBytes: 8 * MIB },
};
export const entryBytes = (namespace: string, row: HawdbEntry) => Buffer.byteLength(namespace) + Buffer.byteLength(row.key) + Buffer.byteLength(row.payload);
