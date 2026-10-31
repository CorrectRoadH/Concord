// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { NodeSocket } from '@effect/platform-node';
import { Effect, Layer, Queue, Schema, Stream } from 'effect';
import { RpcClient, RpcSerialization } from 'effect/unstable/rpc';
import { WorkspaceRpcs, PROTOCOL, RESULT_LIMIT, FRAME_LIMIT, type WorkspaceClient, type Packet, WorkspaceServerError } from './protocol.js';
import { collectPackets } from './computation.js';

export const connectWorkspaceSocket = Effect.fn('connectWorkspaceSocket')(function*(path: string, installation: string, token: string) {
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })),
    Layer.provide(NodeSocket.layerNet({ path })),
  );
  const context = yield* Layer.build(protocol);
  const client = yield* RpcClient.make(WorkspaceRpcs).pipe(Effect.provideContext(context));
  const hello = yield* client.hello({ installation, protocol: PROTOCOL }).pipe(Effect.timeout('1 second'));
  if (hello.token !== token) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Instance token differs from the running record' }));
  return { client, hello, identity: () => ({ token, installation, requestId: crypto.randomUUID(), deadline: Date.now() + 60_000 }) };
});
export type WorkspaceConnection = Effect.Success<ReturnType<typeof connectWorkspaceSocket>>;
export const requestWorkspace = <N extends Exclude<keyof WorkspaceClient, 'hello' | 'shutdown' | 'subscribe'>>(connection: WorkspaceConnection, name: N, input: Omit<Parameters<WorkspaceClient[N]>[0], 'token' | 'installation' | 'requestId' | 'deadline'>) => {
  const call = connection.client[name] as (input: unknown) => Stream.Stream<typeof Packet.Type, unknown>;
  return collectPackets(call({ ...input, ...connection.identity() }));
};

export const subscribeWorkspace = (connection: WorkspaceConnection) => Stream.callback<unknown, unknown>(queue => Effect.gen(function*() {
  let chunks: Uint8Array[] = [], size = 0;
  yield* Effect.forkScoped(Stream.runForEach(connection.client.subscribe({ ...connection.identity(), kind: 'workspace' }), part => Effect.gen(function*() {
    size += part.data.byteLength;
    if (size > RESULT_LIMIT) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerOutputLimit', message: 'Subscription event exceeds 32 MiB' }));
    chunks.push(part.data);
    if (!part.last) return;
    const value = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Json)(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks)))), catch: cause => new WorkspaceServerError({ code: 'WorkspaceServerProtocol', message: String(cause) }) });
    chunks = []; size = 0;
    yield* Queue.offer(queue, value);
  })).pipe(Effect.catch(cause => Queue.fail(queue, cause)), Effect.andThen(Queue.end(queue))));
}));
