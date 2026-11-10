// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import type { Scope } from 'effect';
import { Deferred, Effect, Option } from 'effect';
import { NodeSocket } from '@effect/platform-node';
import { RpcServer } from 'effect/rpc';
import { Socket, SocketServer } from 'effect/socket';
import { makeRequestAdmission, type RequestAdmission } from './request-admission.ts';

/** Connection and request admission surrounds the actual Effect RPC protocol. */
export const makeAdmittedProtocol = Effect.fn('makeAdmittedProtocol')(function*(server: SocketServer.SocketServer['Service'], connected: Effect.Effect<unknown, never, Scope.Scope>, disconnected: (client: number) => void, admission: RequestAdmission = makeRequestAdmission()) {
  const requests = new Map<number, Map<string, () => void>>();
  const close = new Map<number, Effect.Effect<void>>();
  let connections = 0, nextId = 0, sending = 0;
  const sockets: SocketServer.SocketServer['Service'] = { ...server, run: handler => server.run(socket => Effect.scoped(Effect.gen(function*() {
    const writer = yield* socket.writer;
    const peerClosed = yield* Deferred.make<void>();
    const net = yield* Effect.serviceOption(NodeSocket.NetSocket);
    // Accepted sockets never reconnect. The generic writer waits for another
    // reader after disconnect; letting a late RPC reply do that deadlocks its
    // uninterruptible response finalizer and therefore the entire server scope.
    if (Option.isSome(net)) yield* Effect.acquireRelease(Effect.sync(() => {
      const closed = () => { Deferred.doneUnsafe(peerClosed, Effect.void); };
      net.value.once('close', closed);
      if (net.value.destroyed) closed();
      return closed;
    }), closed => Effect.sync(() => { net.value.off('close', closed); }));
    yield* Effect.addFinalizer(() => Deferred.succeed(peerClosed, undefined).pipe(Effect.asVoid));
    const write: Socket.Writer['write'] = chunk => Effect.suspend(() => {
      const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk instanceof Socket.CloseEvent ? 0 : chunk.byteLength;
      if (sending + size > 64 * 1024 * 1024) return busy;
      sending += size;
      return (Deferred.isDoneUnsafe(peerClosed) ? Effect.void : writer.write(chunk).pipe(Effect.raceFirst(Deferred.await(peerClosed)))).pipe(Effect.ensuring(Effect.sync(() => { sending -= size; })));
    });
    const busy = writer.write(new Socket.CloseEvent(1013, 'WorkspaceServerBusy')).pipe(Effect.ignore);
    if (connections >= 64) { yield* busy; return; }
    const id = nextId++; connections++; close.set(id, busy);
    yield* Effect.addFinalizer(() => Effect.sync(() => { connections--; close.delete(id); for (const release of requests.get(id)?.values() ?? []) release(); requests.delete(id); disconnected(id); }));
    yield* connected;
    const bounded = Socket.make({ ...socket,
      writer: Effect.succeed({ write, writeAll: chunks => Effect.forEach(chunks, write, { discard: true }) }),
    });
    yield* handler(bounded);
  }))) };
  const protocol = yield* RpcServer.makeProtocolSocketServer.pipe(Effect.provideService(SocketServer.SocketServer, sockets));
  return {
    ...protocol,
    run: dispatch => protocol.run((id, message) => {
      if (message._tag === 'Request') {
        const pending = requests.get(id) ?? new Map<string, () => void>();
        if (pending.size >= 8 || pending.has(String(message.id))) return close.get(id) ?? Effect.void;
        const release = admission.reserve();
        if (!release) return close.get(id) ?? Effect.void;
        pending.set(String(message.id), release); requests.set(id, pending);
      }
      return dispatch(id, message);
    }),
    send: (id, message, transferables) => {
      if (message._tag === 'Exit') {
        requests.get(id)?.get(String(message.requestId))?.();
        requests.get(id)?.delete(String(message.requestId));
      }
      return protocol.send(id, message, transferables);
    },
  } satisfies RpcServer.Protocol['Service'];
});
