// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { channel } from 'node:diagnostics_channel';
import type * as ClientTypes from './client.ts';
import { NodeSocket } from '@effect/platform-node';
import { Cause, Deferred, Effect, Layer, Queue, Schema, Stream } from 'effect';
import * as RpcClient from 'effect/rpc/RpcClient';
import { RpcClientDefect, RpcClientError } from 'effect/rpc/RpcClientError';
import * as RpcSerialization from 'effect/rpc/RpcSerialization';
import { SocketError } from 'effect/socket/Socket';
import { WorkspaceRpcs, PROTOCOL, RESULT_LIMIT, FRAME_LIMIT, type WorkspaceClient, type Packet, WorkspaceServerError, ReadCodec } from './protocol.ts';
import { collectPackets, collectBytes } from './protocol.ts';
import { ConcordError, decodeWorkspaceRead } from '../../model/index.ts';
import type { RemoteFeedback } from '../../model/index.ts';
import type { CacheDerivationBatch } from '../../model/index.ts';

export const connectWorkspaceSocket = Effect.fn('connectWorkspaceSocket')(function*(path: string, installation: string, token: string, scope?: string, countReuse = true, eventEnvironment: Readonly<NodeJS.ProcessEnv> = {}) {
  const environment = Object.freeze({ ...eventEnvironment });
  const opened = yield* Deferred.make<void, WorkspaceServerError>();
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(RpcSerialization.layerSchemaBinary({ maxFrameSize: FRAME_LIMIT })),
    Layer.provide(NodeSocket.layerNet({ path })),
    Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, { onConnect: Deferred.succeed(opened, undefined).pipe(Effect.asVoid), onDisconnect: Deferred.fail(opened, new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Socket closed before opening' })).pipe(Effect.asVoid) })),
  );
  // The socket protocol promotes write errors to defects. Restore the typed
  // transport boundary before the generated client can log or propagate them.
  const safeProtocol = Layer.effect(RpcClient.Protocol, Effect.gen(function*() {
    const transport = yield* RpcClient.Protocol;
    return {
      ...transport,
      send: (...args: Parameters<typeof transport.send>) => Effect.suspend(() => transport.send(...args)).pipe(Effect.catchCause(cause => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
        const error = Cause.squash(cause);
        const detail = SocketError.is(error) && 'cause' in error.reason ? error.reason.cause : error;
        return Effect.fail(error instanceof RpcClientError ? error : new RpcClientError({ reason: new RpcClientDefect({ message: `Workspace socket write failed: ${detail instanceof Error ? detail.message : String(detail)}`, cause: error }) }));
      })),
    };
  })).pipe(Layer.provide(protocol));
  const context = yield* Layer.build(safeProtocol);
  const client = yield* RpcClient.make(WorkspaceRpcs).pipe(Effect.provideContext(context));
  yield* Deferred.await(opened);
  const hello = yield* client.hello({ installation, protocol: PROTOCOL, ...(scope === undefined ? {} : { scope }) });
  if (hello.token !== token) return yield* Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Instance token differs from the running record' }));
  yield* Effect.sync(() => {
    const events = channel('concord.test.process-event');
    if (countReuse && events.hasSubscribers) events.publish({ kind: 'service-reuse', environment });
  });
  return { client, hello, identity: () => ({ token, installation, ...(scope === undefined ? {} : { scope }), requestId: crypto.randomUUID(), deadline: Date.now() + 60_000 }) };
}, Effect.catchTag('RpcClientError', () => Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Workspace service transport is unavailable' }))),
Effect.timeoutOrElse({ duration: '1 second', orElse: () => Effect.fail(new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: 'Workspace service did not complete a handshake within one second' })) }));
export type WorkspaceConnection = Effect.Success<ReturnType<typeof connectWorkspaceSocket>>;
export const requestWorkspace = <N extends Exclude<keyof WorkspaceClient, 'hello' | 'shutdown' | 'subscribe'>>(connection: WorkspaceConnection, name: N, input: Omit<Parameters<WorkspaceClient[N]>[0], 'token' | 'installation' | 'requestId' | 'deadline'>) => {
  const call = connection.client[name] as (input: unknown) => Stream.Stream<typeof Packet.Type, unknown>;
  const stream = call({ ...(name === 'query' ? JSON.parse(JSON.stringify(input)) : input), ...connection.identity() });
  const result = name === 'read' ? collectBytes(stream, 64 * FRAME_LIMIT).pipe(Effect.flatMap(bytes => Schema.decodeUnknownEffect(ReadCodec, { onExcessProperty: 'error' })(bytes)), Effect.map(decodeWorkspaceRead)) : collectPackets(stream);
  return result.pipe(Effect.mapError(cause => cause instanceof RpcClientError
    ? new WorkspaceServerError({ code: 'WorkspaceServerUnavailable', message: `Workspace service transport is unavailable: ${cause.message}` }) : cause));
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

export const submitFeedback = Effect.fn('submitFeedback')(function*(connection: ClientTypes.WorkspaceConnection, connectionId: string, items: readonly RemoteFeedback[]) {
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

export const submitDerivations = Effect.fn('submitDerivations')(function*(connection: WorkspaceConnection, batches: readonly CacheDerivationBatch[]) {
  if (batches.length === 0) return;
  const data = Buffer.from(JSON.stringify(batches));
  if (data.byteLength > RESULT_LIMIT) return yield* Effect.fail(new ConcordError('WorkspaceServerInputLimit', 'Cache derivations exceed 32 MiB'));
  const session = crypto.randomUUID();
  yield* requestWorkspace(connection, 'cache-derived', { action: 'begin', session });
  for (let offset = 0; offset < data.byteLength; offset += FRAME_LIMIT / 2) {
    yield* requestWorkspace(connection, 'cache-derived', { action: 'append', session, data: data.subarray(offset, offset + FRAME_LIMIT / 2) });
  }
  yield* requestWorkspace(connection, 'cache-derived', { action: 'commit', session });
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
