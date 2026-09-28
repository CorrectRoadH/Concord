// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { Schema } from 'effect';

export const MAX_SCAN_REPLY_BYTES = 128 * 1024 * 1024;
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Cache = Schema.Struct({ status: Schema.String, hits: Schema.optional(Count), misses: Schema.optional(Count), failure: Schema.optional(Schema.String) });
export const ScanSuccess = Schema.Struct({
  kind: Schema.Literal('success'),
  body: Schema.String.check(Schema.isMaxLength(MAX_SCAN_REPLY_BYTES)),
  phases: Schema.Array(Schema.Struct({ name: Schema.String, ms: Schema.Number, count: Count })),
  observations: Schema.Array(Schema.Literals(['incomplete-scan', 'source-changed', 'orphan-annotation', 'cache-unavailable', 'native-artifact-mismatch'])),
  caches: Schema.Struct({ annotations: Schema.optional(Cache), code: Schema.optional(Cache) }),
});
export const ScanReply = Schema.Union([ScanSuccess, Schema.Struct({ kind: Schema.Literal('failure'), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Unknown) })]);
export const ScanRequest = Schema.Struct({ id: Count });
export const ScanMessage = Schema.Struct({ id: Count, reply: ScanReply });
export type ScanSuccess = typeof ScanSuccess.Type;
