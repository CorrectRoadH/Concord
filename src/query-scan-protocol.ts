// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { Schema } from 'effect';
import { ReviewRenderValue, TraceGapsValue, TraceShowValue } from './query-values.js';
export const QueryScanMessage = Schema.Union([
  Schema.Struct({ format: Schema.Literal('concord.query-scan/v1'), ok: Schema.Literal(true), scannedAt: Schema.Number, finishedAt: Schema.Number,
    value: Schema.Union([TraceGapsValue, TraceShowValue, ReviewRenderValue]), complete: Schema.Boolean, unknown: Schema.Array(Schema.Literal('code')),
    drift: Schema.Struct({ files: Schema.Array(Schema.String), directories: Schema.Array(Schema.String), publicationChanged: Schema.Boolean }) }),
  Schema.Struct({ format: Schema.Literal('concord.query-scan/v1'), ok: Schema.Literal(false), scannedAt: Schema.Number, code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) }),
]);
export type QueryScanMessage = typeof QueryScanMessage.Type;
export const decodeQueryScanMessage = Schema.decodeUnknownSync(QueryScanMessage, { onExcessProperty: 'error' });
