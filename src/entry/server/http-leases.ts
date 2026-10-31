// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
import { Clock, Effect, Semaphore } from 'effect';
import { ConcordError } from '../../model/index.js';

export interface HostedHttp { readonly host: string; readonly port: number; readonly address: string; close(): Promise<void> }
interface Listener { readonly handle: HostedHttp; readonly leases: Map<string, { readonly transient: boolean; readonly owner?: number }>; sse: number; idleSince: number }
export const makeHttpLeases = Effect.fn('makeHttpLeases')(function*(token: string, start: (host: string, port: number, sse: (delta: number) => void) => Effect.Effect<HostedHttp, unknown>) {
  const mutex = yield* Semaphore.make(1);
  const listeners = new Map<string, Listener>();
  const closeUnused = (key: string, listener: Listener) => Effect.gen(function*() {
    if (listener.leases.size === 0 && listener.sse === 0) {
      yield* Effect.tryPromise(() => listener.handle.close()); listeners.delete(key);
    }
  });
  const open = (host: string, port: number, transient: boolean, owner?: number) => mutex.withPermit(Effect.gen(function*() {
    const key = `${host}\0${port}`;
    let listener = listeners.get(key);
    if (!listener) {
      const handle = yield* start(host, port, delta => {
        const current = listeners.get(key);
        if (current) {
          current.sse = Math.max(0, current.sse + delta);
          if (current.sse === 0) Effect.runFork(Clock.currentTimeMillis.pipe(Effect.tap(now => Effect.sync(() => { current.idleSince = now; }))));
          Effect.runFork(mutex.withPermit(closeUnused(key, current)));
        }
      });
      listener = { handle, leases: new Map(), sse: 0, idleSince: yield* Clock.currentTimeMillis };
      listeners.set(key, listener);
    }
    const lease = `${token}:${crypto.randomUUID()}`;
    listener.leases.set(lease, { transient, ...(transient || owner === undefined ? {} : { owner }) });
    return { host: listener.handle.host, port: listener.handle.port, address: listener.handle.address, lease, token };
  }));
  const close = (lease: string) => mutex.withPermit(Effect.gen(function*() {
    if (!lease.startsWith(`${token}:`)) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'HTTP lease belongs to another service instance'));
    for (const [key, listener] of listeners) if (listener.leases.delete(lease)) { yield* closeUnused(key, listener); return; }
  }));
  const tick = mutex.withPermit(Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis;
    for (const [key, listener] of listeners) {
      if (listener.sse === 0 && now - listener.idleSince >= 600_000) for (const [lease, value] of listener.leases) if (value.transient) listener.leases.delete(lease);
      yield* closeUnused(key, listener);
    }
  }));
  const disconnect = (owner: number) => mutex.withPermit(Effect.gen(function*() {
    for (const [key, listener] of listeners) {
      for (const [lease, value] of listener.leases) if (value.owner === owner) listener.leases.delete(lease);
      yield* closeUnused(key, listener);
    }
  }));
  const shutdown = mutex.withPermit(Effect.forEach(listeners.values(), listener => Effect.tryPromise(() => listener.handle.close()), { discard: true }).pipe(Effect.ensuring(Effect.sync(() => listeners.clear()))));
  yield* Effect.addFinalizer(() => shutdown.pipe(Effect.orDie));
  return { open, close, tick, disconnect };
});
