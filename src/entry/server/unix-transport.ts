// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#退出
import { createServer, type Socket as NetSocket } from 'node:net';
import { NodeSocket } from '@effect/platform-node';
import { Effect, FiberSet } from 'effect';
import { NetAddress } from 'effect/net';
import { Socket, SocketServer } from 'effect/socket';

export const makeUnixTransport = Effect.fn('UnixTransport.listen')(function*(path: string, beforeClose: Effect.Effect<void>) {
  const peers = new Set<NetSocket>();
  let closing = false;
  let dispatch: ((peer: NetSocket) => void) | undefined;
  const server = createServer({ pauseOnConnect: true }, peer => {
    peers.add(peer);
    peer.once('close', () => { peers.delete(peer); });
    peer.on('error', () => { peer.destroy(); });
    if (closing) peer.destroy();
    else dispatch?.(peer);
  });

  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    yield* beforeClose;
    yield* Effect.sync(() => {
      closing = true;
      try { server.close(); }
      finally { for (const peer of peers) peer.destroy(); }
    }).pipe(Effect.ensuring(Effect.gen(function*() {
      // Bun clears listening when it stops the native listener. Each accepted
      // peer stays registered until its own close event confirms destruction.
      while (server.listening || peers.size > 0) yield* Effect.sleep('10 millis');
    })));
  }));

  yield* Effect.tryPromise({
    try: () => new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(path, resolve);
    }),
    catch: cause => new SocketServer.SocketServerError({ reason: new SocketServer.SocketServerOpenError({ cause }) }),
  });

  const run: SocketServer.SocketServer['Service']['run'] = <A, E, R>(handler: (socket: Socket.Socket) => Effect.Effect<A, E, R>) => Effect.scoped(Effect.gen(function*() {
    const fibers = yield* FiberSet.make();
    const fork = yield* FiberSet.runtime(fibers)<R>();
    yield* Effect.addFinalizer(() => Effect.sync(() => { dispatch = undefined; }));
    dispatch = peer => {
      if (peer.destroyed) return;
      const open = Effect.acquireRelease(Effect.suspend(() => peer.destroyed
        ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketCloseError({ code: 1000 }) }))
        : Effect.succeed(peer)), socket => Effect.sync(() => {
        if (!socket.destroyed) socket.destroySoon();
      }));
      fork(NodeSocket.fromDuplex(open).pipe(
        Effect.flatMap(handler),
        Effect.ignoreCause({ log: 'Unhandled', message: 'Unhandled error in SocketServer' }),
        Effect.provideService(NodeSocket.NetSocket, peer),
      ));
    };
    for (const peer of peers) dispatch(peer);
    return yield* Effect.never;
  }));

  return SocketServer.SocketServer.of({ address: NetAddress.unixPathAddress(path), run });
});
