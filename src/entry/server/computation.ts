// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';
import { Query, QueryRequest } from '../../app/index.ts';
import { CacheDerivationBatch } from '../../model/index.ts';
import { Packet, QueryEnvironment, strict, WorkspaceServerError } from './protocol.ts';

export { Snapshot } from './operation-protocol.ts';
export const ComputationReply = strict(Schema.Struct({ value: Schema.Json, derived: Schema.Array(CacheDerivationBatch) }));
export const Computation = Schema.Union([
  strict(Schema.Struct({ kind: Schema.Literal('scan') })),
  strict(Schema.Struct({ kind: Schema.Literal('cache-rebuild') })),
  strict(Schema.Struct({ kind: Schema.Literal('query-scan'), query: Query })),
  strict(Schema.Struct({ kind: Schema.Literal('query'), request: QueryRequest, environment: Schema.optional(QueryEnvironment), cache: Schema.optional(Schema.Literals(['use', 'off'])) })),
  strict(Schema.Struct({ kind: Schema.Literal('read'), path: Schema.String })),
  strict(Schema.Struct({ kind: Schema.Literal('read-bytes'), path: Schema.String })),
  strict(Schema.Struct({ kind: Schema.Literal('git-status') })),
  strict(Schema.Struct({ kind: Schema.Literal('git-diff'), path: Schema.String, area: Schema.Literals(['staged', 'unstaged', 'untracked']) })),
  strict(Schema.Struct({ kind: Schema.Literal('p5-compile'), input: Schema.Json })),
]);
export type Computation = typeof Computation.Type;
export const ComputeRpcs = RpcGroup.make(Rpc.make('snapshot', {
  payload: strict(Schema.Struct({ id: Schema.String, data: Schema.Uint8Array, last: Schema.Boolean })), success: Schema.Void, error: WorkspaceServerError,
}), Rpc.make('execute', {
  payload: strict(Schema.Struct({ operation: Schema.Json, snapshotId: Schema.String })),
  success: Packet, error: WorkspaceServerError, stream: true,
}));
