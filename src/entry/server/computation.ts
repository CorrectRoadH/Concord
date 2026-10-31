// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect, Schema, Stream } from 'effect';
import { Rpc, RpcGroup } from 'effect/unstable/rpc';
import { QueryRequest } from '../../app/index.js';
import { Packet, strict, WorkspaceServerError, RESULT_LIMIT } from './protocol.js';

const Row = strict(Schema.Struct({ key: Schema.String, payload: Schema.String }));
export const Snapshot = strict(Schema.Struct({
  feedback_cache: Schema.optional(Schema.Array(Row)),
  query_cache: Schema.optional(Schema.Array(Row)),
  workspace_projection: Schema.optional(Schema.Array(Row)),
}));
export const Computation = Schema.Union([
  strict(Schema.Struct({ kind: Schema.Literal('scan') })),
  strict(Schema.Struct({ kind: Schema.Literal('query'), request: QueryRequest })),
  strict(Schema.Struct({ kind: Schema.Literal('read'), path: Schema.String })),
  strict(Schema.Struct({ kind: Schema.Literal('git-status') })),
  strict(Schema.Struct({ kind: Schema.Literal('git-diff'), path: Schema.String, area: Schema.Literals(['staged', 'unstaged', 'untracked']) })),
  strict(Schema.Struct({ kind: Schema.Literal('p5-compile'), input: Schema.Json })),
]);
export type Computation = typeof Computation.Type;
export const ComputeRpcs = RpcGroup.make(Rpc.make('execute', {
  payload: strict(Schema.Struct({ operation: Computation, snapshot: Snapshot })),
  success: Packet, error: WorkspaceServerError, stream: true,
}));

export const collectPackets = <E, R>(stream: Stream.Stream<typeof Packet.Type, E, R>) => Effect.gen(function*() {
  const chunks: Uint8Array[] = [];
  let size = 0, ended = false;
  yield* Stream.runForEach(stream, part => Effect.try({ try: () => {
    if (ended || part.data.byteLength > 1024 * 1024) throw new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: 'Invalid result chunk' });
    size += part.data.byteLength;
    if (size > RESULT_LIMIT) throw new WorkspaceServerError({ code: 'WorkspaceServerOutputLimit', message: 'Result exceeds 32 MiB' });
    chunks.push(part.data); ended = part.last;
  }, catch: cause => cause }));
  if (!ended) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: 'Incomplete result' }));
  return yield* Effect.try({ try: () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), catch: cause => cause });
});
