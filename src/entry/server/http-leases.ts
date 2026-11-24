// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
import { Clock, Effect, Semaphore } from 'effect';
import { ConcordError } from '../../model/index.ts';

export interface HostedHttp { readonly host: string; readonly port: number; readonly address: string; close(): Promise<void> }
type Lease = { readonly transient: true; readonly openedAt: number } | { readonly transient: false; readonly owner: number | undefined };
interface SseActivity { count: number; idleSince: number }
interface Listener { readonly handle: HostedHttp; readonly leases: Map<string, Lease>; readonly sse: SseActivity }
const PANEL_IDLE_TIMEOUT_MS = 600_000;

export const makeHttpLeases = Effect.fn('makeHttpLeases')(function*(token: string, start: (host: string, port: number, sse: (delta: number) => void) => Effect.Effect<HostedHttp, unknown>) {
  const mutex = yield* Semaphore.make(1);
  const clock = yield* Clock.Clock;
  const listeners = new Map<string, Listener>();
  const closeUnused = (key: string, listener: Listener) => Effect.gen(function*() {
    if (listener.leases.size === 0 && listener.sse.count === 0) {
      yield* Effect.tryPromise(() => listener.handle.close()); listeners.delete(key);
    }
  });
  const open = (host: string, port: number, transient: boolean, owner?: number) => mutex.withPermit(Effect.gen(function*() {
    const key = `${host}\0${port}`;
    let listener = listeners.get(key);
    if (!listener) {
      const sse: SseActivity = { count: 0, idleSince: clock.currentTimeMillisUnsafe() };
      const handle = yield* start(host, port, delta => {
        sse.count = Math.max(0, sse.count + delta);
        if (sse.count !== 0) return;
        sse.idleSince = clock.currentTimeMillisUnsafe();
        Effect.runFork(mutex.withPermit(Effect.suspend(() => {
          // Tick may have closed this listener and an open may have replaced it while we waited.
          const current = listeners.get(key);
          return current?.sse === sse ? closeUnused(key, current) : Effect.void;
        })));
      });
      listener = { handle, leases: new Map(), sse };
      listeners.set(key, listener);
    }
    const lease = `${token}:${crypto.randomUUID()}`;
    listener.leases.set(lease, transient ? { transient: true, openedAt: clock.currentTimeMillisUnsafe() } : { transient: false, owner });
    return { host: listener.handle.host, port: listener.handle.port, address: listener.handle.address, lease, token };
  }));
  const close = (lease: string) => mutex.withPermit(Effect.gen(function*() {
    if (!lease.startsWith(`${token}:`)) return yield* Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'HTTP lease belongs to another service instance'));
    for (const [key, listener] of listeners) if (listener.leases.delete(lease)) { yield* closeUnused(key, listener); return; }
  }));
  const tick = mutex.withPermit(Effect.gen(function*() {
    const now = clock.currentTimeMillisUnsafe();
    for (const [key, listener] of listeners) {
      if (listener.sse.count === 0) {
        for (const [lease, value] of listener.leases) {
          if (value.transient && now - Math.max(value.openedAt, listener.sse.idleSince) >= PANEL_IDLE_TIMEOUT_MS) listener.leases.delete(lease);
        }
      }
      yield* closeUnused(key, listener);
    }
  }));
  const disconnect = (owner: number) => mutex.withPermit(Effect.gen(function*() {
    for (const [key, listener] of listeners) {
      for (const [lease, value] of listener.leases) if (!value.transient && value.owner === owner) listener.leases.delete(lease);
      yield* closeUnused(key, listener);
    }
  }));
  const shutdown = mutex.withPermit(Effect.forEach(listeners.values(), listener => Effect.tryPromise(() => listener.handle.close()), { discard: true }).pipe(Effect.ensuring(Effect.sync(() => listeners.clear()))));
  yield* Effect.addFinalizer(() => shutdown.pipe(Effect.orDie));
  return { open, close, tick, disconnect };
});
