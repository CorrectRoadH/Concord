// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { NodeSocket } from '@effect/platform-node';
import { Deferred, Effect, Layer, Queue, Schema, Stream } from 'effect';
import * as RpcClient from 'effect/unstable/rpc/RpcClient';
import * as RpcSerialization from 'effect/unstable/rpc/RpcSerialization';
import { WorkspaceRpcs, PROTOCOL, RESULT_LIMIT, FRAME_LIMIT, type WorkspaceClient, type Packet, WorkspaceServerError, ReadCodec } from './protocol.js';
import { collectPackets, collectBytes } from './protocol.js';
import { ConcordError, decodeWorkspaceRead } from '../../model/index.js';
import type { RemoteFeedback } from '../../model/index.js';

export const connectWorkspaceSocket = Effect.fn('connectWorkspaceSocket')(function*(path: string, installation: string, token: string) {
  const opened = yield* Deferred.make<void, WorkspaceServerError>();
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })),
    Layer.provide(NodeSocket.layerNet({ path })),
    Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, { onConnect: Deferred.succeed(opened, undefined).pipe(Effect.asVoid), onDisconnect: Deferred.fail(opened, new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Socket closed before opening' })).pipe(Effect.asVoid) })),
  );
  const context = yield* Layer.build(protocol);
  const client = yield* RpcClient.make(WorkspaceRpcs).pipe(Effect.provideContext(context));
  yield* Deferred.await(opened);
  const hello = yield* client.hello({ installation, protocol: PROTOCOL });
  if (hello.token !== token) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Instance token differs from the running record' }));
  return { client, hello, identity: () => ({ token, installation, requestId: crypto.randomUUID(), deadline: Date.now() + 60_000 }) };
}, Effect.timeout('1 second'));
export type WorkspaceConnection = Effect.Success<ReturnType<typeof connectWorkspaceSocket>>;
export const requestWorkspace = <N extends Exclude<keyof WorkspaceClient, 'hello' | 'shutdown' | 'subscribe'>>(connection: WorkspaceConnection, name: N, input: Omit<Parameters<WorkspaceClient[N]>[0], 'token' | 'installation' | 'requestId' | 'deadline'>) => {
  const call = connection.client[name] as (input: unknown) => Stream.Stream<typeof Packet.Type, unknown>;
  const stream = call({ ...(name === 'query' ? JSON.parse(JSON.stringify(input)) : input), ...connection.identity() });
  return name === 'read' ? collectBytes(stream, 64 * FRAME_LIMIT).pipe(Effect.flatMap(bytes => Schema.decodeUnknownEffect(ReadCodec, { onExcessProperty: 'error' })(bytes)), Effect.map(decodeWorkspaceRead)) : collectPackets(stream);
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

export const submitFeedback = Effect.fn('submitFeedback')(function*(connection: import('./client.js').WorkspaceConnection, connectionId: string, items: readonly RemoteFeedback[]) {
  const session = crypto.randomUUID();
  yield* requestWorkspace(connection, 'feedback-merge', { action: 'begin', session, connectionId });
  let batch: RemoteFeedback[] = [], bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (size > FRAME_LIMIT - 8192) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'One feedback item exceeds a frame'));
    if (bytes + size > FRAME_LIMIT - 8192) {
      yield* requestWorkspace(connection, 'feedback-merge', { action: 'append', session, items: JSON.parse(JSON.stringify(batch)) });
      batch = []; bytes = 2;
    }
    batch.push(item); bytes += size;
  }
  if (batch.length > 0) yield* requestWorkspace(connection, 'feedback-merge', { action: 'append', session, items: JSON.parse(JSON.stringify(batch)) });
  const reply = yield* requestWorkspace(connection, 'feedback-merge', { action: 'commit', session });
  const decoded = yield* Schema.decodeUnknownEffect(Schema.Struct({ warnings: Schema.Array(Schema.String) }), { onExcessProperty: 'error' })(reply);
  return decoded.warnings;
});

export const serverStartupWait = '10 seconds' as const;
/** Startup may load an installation; existing-service handshakes retain their own one-second bound. */
export const waitForServerHandshake = <A, E, R>(attempt: Effect.Effect<A | undefined, E, R>) => Effect.gen(function*() {
  for (;;) {
    const value = yield* attempt.pipe(Effect.catch(() => Effect.succeed(undefined)));
    if (value !== undefined) return value;
    yield* Effect.sleep('10 millis');
  }
}).pipe(Effect.timeout(serverStartupWait), Effect.mapError(() => new ConcordError('WorkspaceServerUnavailable', 'No workspace service completed a handshake within ten seconds')));
