// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import type * as RpcClientTypes from 'effect/rpc/RpcClient';
import type { RpcClientError } from 'effect/rpc/RpcClientError';
import { Effect, Schema, Stream } from 'effect';
import * as Rpc from 'effect/rpc/Rpc';
import * as RpcGroup from 'effect/rpc/RpcGroup';
import * as SchemaBinary from 'effect/encoding/SchemaBinary';
import { WorkspaceRead } from '../../model/index.ts';
import { isAbsolute } from 'node:path';

export const PROTOCOL = 'concord.workspace/v2';
export const FRAME_LIMIT = 1024 * 1024;
export const RESULT_LIMIT = 32 * FRAME_LIMIT;
export const ReadCodec = SchemaBinary.toCodec(WorkspaceRead);
export const ServerState = Schema.Literals(['opening', 'running', 'degraded', 'draining', 'clearing', 'maintaining', 'blocked', 'stopping']);
export type ServerState = typeof ServerState.Type;
export const strict = <S extends Schema.Top>(schema: S): S['Rebuild'] => schema.annotate({ parseOptions: { onExcessProperty: 'error' } });
export class WorkspaceServerError extends Schema.TaggedError<WorkspaceServerError>()('WorkspaceServerError', {
  code: Schema.String, message: Schema.String, details: Schema.optional(Schema.Json),
}) {}
export const CommandScope = strict(Schema.Struct({ root: Schema.String, privateDir: Schema.String, key: Schema.String }));
export const QueryEnvironment = Schema.Record(Schema.String, Schema.String);
export const CallerCwd = Schema.String.check(Schema.makeFilter(value => isAbsolute(value) && !value.includes('\0')));
export const HelloInput = strict(Schema.Struct({ protocol: Schema.String, installation: Schema.String, scope: Schema.optional(Schema.String) }));
export const Hello = strict(Schema.Struct({ protocol: Schema.String, installation: Schema.String, token: Schema.String, state: ServerState, sourceDigest: Schema.NullOr(Schema.String), error: Schema.optional(strict(Schema.Struct({ code: Schema.String, message: Schema.String }))) }));
export const Identity = { token: Schema.String, installation: Schema.String, requestId: Schema.String, deadline: Schema.Number, scope: Schema.optional(Schema.String) };
export const Packet = strict(Schema.Struct({ data: Schema.Uint8Array, last: Schema.Boolean }));
export const QueryInput = strict(Schema.Struct({ name: Schema.String, input: Schema.Json }));
const empty = strict(Schema.Struct(Identity));
const rpc = <const N extends string, S extends Schema.Top>(name: N, payload: S) => Rpc.make(name, { payload, success: Packet, error: WorkspaceServerError, stream: true });
export const WorkspaceRpcs = RpcGroup.make(
  Rpc.make('hello', { payload: HelloInput, success: Hello, error: WorkspaceServerError }),
  Rpc.make('shutdown', { payload: strict(Schema.Struct({ token: Schema.String, scope: Schema.optional(Schema.String) })), success: Schema.Void, error: WorkspaceServerError }),
  rpc('subscribe', strict(Schema.Struct({ ...Identity, kind: Schema.Literal('workspace') }))),
  rpc('workspace', empty),
  rpc('refresh', empty),
  rpc('read', strict(Schema.Struct({ ...Identity, path: Schema.String, expectedDigest: Schema.optional(Schema.String) }))),
  rpc('query', strict(Schema.Struct({ ...Identity, ...QueryInput.fields, cwd: CallerCwd, environment: QueryEnvironment, cache: Schema.Literals(['use', 'off']) }))),
  rpc('git-status', empty),
  rpc('git-diff', strict(Schema.Struct({ ...Identity, path: Schema.String, area: Schema.Literals(['staged', 'unstaged', 'untracked']) }))),
  rpc('http', strict(Schema.Struct({ ...Identity, action: Schema.Literals(['open', 'close']), host: Schema.String, port: Schema.Int, lease: Schema.optional(Schema.String) }))),
  rpc('cache-clear', empty),
  rpc('cache-status', empty),
  rpc('cache-rebuild', empty),
  rpc('cache-snapshot', empty),
  rpc('cache-derived', strict(Schema.Struct({ ...Identity, action: Schema.Literals(['begin', 'append', 'commit']), session: Schema.String, data: Schema.optional(Schema.Uint8Array) }))),
  rpc('feedback-merge', strict(Schema.Struct({ ...Identity, action: Schema.Literals(['begin', 'append', 'commit']), session: Schema.String, connectionId: Schema.optional(Schema.String), items: Schema.optional(Schema.Json) }))),
);
export type WorkspaceClient = RpcClientTypes.RpcClient<RpcGroup.Rpcs<typeof WorkspaceRpcs>, RpcClientError>;

export const collectBytes = <E, R>(stream: Stream.Stream<typeof Packet.Type, E, R>, limit = RESULT_LIMIT) => Effect.gen(function*() {
  const chunks: Uint8Array[] = [];
  let size = 0, ended = false;
  yield* Stream.runForEach(stream, part => Effect.try({ try: () => {
    if (ended || part.data.byteLength > FRAME_LIMIT) throw new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: 'Invalid result chunk' });
    size += part.data.byteLength;
    if (size > limit) throw new WorkspaceServerError({ code: 'WorkspaceServerOutputLimit', message: 'Result exceeds its byte allowance' });
    chunks.push(part.data); ended = part.last;
  }, catch: cause => cause }));
  if (!ended) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: 'Incomplete result' }));
  return Buffer.concat(chunks);
});
export const collectPackets = <E, R>(stream: Stream.Stream<typeof Packet.Type, E, R>) => collectBytes(stream).pipe(Effect.flatMap(bytes => Effect.try({ try: () => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), catch: cause => cause })));

/** Leave space for the binary RPC envelope; never allocate from a peer's length. */
export function packets(data: Uint8Array, limit = RESULT_LIMIT) {
  if (data.byteLength > limit) throw new WorkspaceServerError({ code: 'WorkspaceServerOutputLimit', message: 'Result exceeds its byte allowance' });
  const result: (typeof Packet.Type)[] = [];
  const size = FRAME_LIMIT - 4096;
  for (let offset = 0; offset < data.byteLength; offset += size) result.push({ data: data.subarray(offset, offset + size), last: offset + size >= data.byteLength });
  if (result.length === 0) result.push({ data: new Uint8Array(), last: true });
  return Stream.fromIterable(result, { chunkSize: 1 });
}
export const jsonPackets = (value: unknown) => packets(new TextEncoder().encode(JSON.stringify(value)));

export function makeOutputAdmission() {
  let retained = 0;
  const bytes = (data: Uint8Array, limit = RESULT_LIMIT) => Stream.unwrap(Effect.acquireRelease(
    Effect.try({ try: () => {
      if (retained + data.byteLength > 64 * FRAME_LIMIT) throw new WorkspaceServerError({ code: 'WorkspaceServerBusy', message: 'Pending output exceeds 64 MiB' });
      retained += data.byteLength;
    }, catch: cause => cause instanceof WorkspaceServerError ? cause : new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: String(cause) }) }),
    () => Effect.sync(() => { retained -= data.byteLength; }),
  ).pipe(Effect.map(() => packets(data, limit))));
  return { bytes, json: (value: unknown) => Stream.unwrap(Effect.sync(() => bytes(new TextEncoder().encode(JSON.stringify(value))))) };
}
