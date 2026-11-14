// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Schema } from 'effect';

export const CacheSnapshotUnavailable = Schema.Struct({
  code: Schema.Literals(['HawdbBusy', 'HawdbUnavailable', 'HawdbIncompatible', 'HawdbLimit', 'HawdbClosed', 'HawdbCommitUnknown', 'HawdbCancelled', 'UnsafePath']), message: Schema.String,
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
export const CacheDerivationBatch = Schema.Struct({
  namespace: Schema.Literals(['annotation_cache', 'code_cache', 'config_cache', 'query_cache']),
  entries: Schema.Array(Schema.Struct({ key: Schema.String, payload: Schema.String }).annotate({ parseOptions: { onExcessProperty: 'error' } })),
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
export type CacheDerivationBatch = typeof CacheDerivationBatch.Type;
