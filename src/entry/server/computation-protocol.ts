// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Cause, Effect, Option, Result, Schema } from 'effect';
import { RpcClient, RpcMessage, RpcSerialization } from 'effect/unstable/rpc';
import { RpcClientDefect, RpcClientError } from 'effect/unstable/rpc/RpcClientError';
import { Socket } from 'effect/unstable/socket';

/** The owned pipe reports exit; synchronous work remains bounded by its request deadline. */
export const makeComputationProtocol = (socket: Socket.Socket) => RpcClient.Protocol.make(Effect.fn('computation.protocol')(function*(writeResponse, clients) {
  const serialization = yield* RpcSerialization.RpcSerialization;
  const hooks = yield* Effect.serviceOption(RpcClient.ConnectionHooks);
  const write = yield* socket.writer;
  const parser = serialization.makeUnsafe();
  const requests = new Map<string | number, number>();
  let terminalError: RpcClientError | undefined;
  const broadcast = (response: RpcMessage.FromServerEncoded) => Effect.forEach(clients, client => writeResponse(client, response), { discard: true });
  const defect = (message: string, cause: unknown) => new RpcClientError({ reason: new RpcClientDefect({ message, cause }) });
  const transportError = (cause: Cause.Cause<unknown>) => {
    const error = Cause.findError(cause);
    if (Result.isSuccess(error)) {
      if (error.success instanceof RpcClientError) return error.success;
      if (Socket.isSocketError(error.success)) return new RpcClientError({ reason: error.success.reason });
    }
    return defect('Computation transport failed', Cause.squash(cause));
  };
  yield* Effect.forkScoped(socket.runRaw(bytes => Effect.try({
    try: () => parser.decode(bytes).map(value => Schema.decodeUnknownSync(RpcMessage.EncodedSchema, { onExcessProperty: 'error' })(value)),
    catch: cause => defect('Invalid computation response', cause),
  }).pipe(Effect.flatMap(responses => Effect.forEach(responses, response => {
    if (response._tag === 'Pong') return Effect.void;
    if (response._tag === 'Exit' || response._tag === 'Chunk') {
      const client = requests.get(response.requestId);
      if (response._tag === 'Exit') requests.delete(response.requestId);
      // Effect's public encoded type still describes JSON chunks; the pinned
      // binary envelope above validates the actual byte-valued chunk and exit.
      return client === undefined ? Effect.void : writeResponse(client, response as unknown as RpcMessage.FromServerEncoded);
    }
    return response._tag === 'Defect' ? broadcast(response) : Effect.fail(defect('Unexpected computation response', response));
  }, { discard: true }))), { onOpen: Option.isSome(hooks) ? hooks.value.onConnect : Effect.void }).pipe(
    Effect.andThen(Effect.fail(defect('Computation output pipe closed', undefined))),
    Effect.ensuring(Option.isSome(hooks) ? hooks.value.onDisconnect : Effect.void),
    Effect.catchCause(cause => {
      terminalError = transportError(cause);
      return broadcast({ _tag: 'ClientProtocolError', error: terminalError });
    }),
    Effect.interruptible,
  ));
  return {
    send: (client, request) => Effect.suspend(() => {
      if (terminalError !== undefined) return Effect.fail(terminalError);
      if (request._tag === 'Request') requests.set(request.id, client);
      return Effect.try({ try: () => parser.encode(request), catch: cause => defect('Invalid computation request', cause) }).pipe(
        Effect.flatMap(bytes => bytes === undefined ? Effect.void : write(bytes).pipe(Effect.mapError(error => new RpcClientError({ reason: error.reason })))),
      );
    }),
    supportsAck: true,
    supportsTransferables: false,
    codecFor: serialization.codecFor,
  };
}));
