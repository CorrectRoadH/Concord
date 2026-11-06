// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { Schema } from 'effect';
import { CacheSnapshotUnavailable, CacheDerivationBatch, ViewActionSchema } from '../../model/index.ts';
import { CallerCwd, QueryEnvironment, strict } from './protocol.ts';

const Row = strict(Schema.Struct({ key: Schema.String, payload: Schema.String }));
export const Snapshot = strict(Schema.Struct({
  unavailable: Schema.optional(CacheSnapshotUnavailable),
  annotation_cache: Schema.optional(Schema.Array(Row)),
  code_cache: Schema.optional(Schema.Array(Row)),
  config_cache: Schema.optional(Schema.Array(Row)),
  feedback_cache: Schema.optional(Schema.Array(Row)),
  query_cache: Schema.optional(Schema.Array(Row)),
  workspace_projection: Schema.optional(Schema.Array(Row)),
}));
export const OperationRequest = Schema.Union([
  strict(Schema.Struct({ kind: Schema.Literal('action'), root: Schema.String, cwd: CallerCwd, environment: QueryEnvironment, input: ViewActionSchema, snapshot: Snapshot })),
  strict(Schema.Struct({ kind: Schema.Literal('job'), root: Schema.String, cwd: CallerCwd, environment: QueryEnvironment, caseId: Schema.String, snapshot: Snapshot })),
]);
export const OperationReply = Schema.Union([
  strict(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json, derived: Schema.Array(CacheDerivationBatch) })),
  strict(Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json) })),
]);
export const OperationReady = strict(Schema.Struct({ ready: Schema.Literal(true) }));
