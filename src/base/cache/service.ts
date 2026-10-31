import { Context, Effect, Layer, type Scope } from 'effect';
import { cacheDatabasePath, assertCacheDatabaseSafe } from './cache-file.js';
import { createMemoryHawdb, openHawdb, HawdbFailure, type HawdbDatabase, type HawdbEntry, type HawdbNamespace } from './hawdb-native.js';

export type ReadonlyCacheSnapshot = Readonly<Partial<Record<HawdbNamespace, readonly HawdbEntry[]>>>;
export interface CacheService {
  readonly memory: Effect.Effect<HawdbDatabase, HawdbFailure, Scope.Scope>;
}
export interface PersistentCacheService {
  readonly open: (privateDir: string) => Effect.Effect<HawdbDatabase | undefined, HawdbFailure, Scope.Scope>;
}
const cacheFailure = (cause: unknown): HawdbFailure => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause));

/** In-memory handles cannot grant access to a persistent namespace. */
export class Cache extends Context.Service<Cache, CacheService>()('concord/base/cache/Cache') {
  static readonly layer = Layer.succeed(Cache, Cache.of({
    memory: Effect.acquireRelease(Effect.try({ try: createMemoryHawdb, catch: cacheFailure }), database => Effect.sync(() => database.close())),
  }));
}

/** An immutable observation supplied by the owner; no handle or write method. */
export class CacheSnapshot extends Context.Service<CacheSnapshot, {
  readonly entries: (namespace: HawdbNamespace) => readonly HawdbEntry[];
}>()('concord/base/cache/CacheSnapshot') {
  static layer(snapshot: ReadonlyCacheSnapshot = {}) {
    const copy = Object.fromEntries(Object.entries(snapshot).map(([namespace, entries]) => [namespace, Object.freeze(entries.map(entry => Object.freeze({ ...entry })))])) as ReadonlyCacheSnapshot;
    return Layer.succeed(CacheSnapshot, CacheSnapshot.of({ entries: namespace => copy[namespace] ?? [] }));
  }
}

/** Native ownership is authoritative. Contention falls back to memory at callers. */
export class PersistentCache extends Context.Service<PersistentCache, PersistentCacheService>()('concord/base/cache/PersistentCache') {
  static readonly layer = Layer.succeed(PersistentCache, PersistentCache.of({
    open: Effect.fn('PersistentCache.open')(function*(privateDir: string) {
      return yield* Effect.acquireRelease(Effect.try({
        try: () => {
          const path = cacheDatabasePath(privateDir);
          assertCacheDatabaseSafe(path);
          try { return openHawdb(path, { readOnly: false, create: true }); }
          catch (cause) { if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy') return undefined; throw cause; }
        }, catch: cacheFailure,
      }), database => Effect.sync(() => database?.close()));
    }),
  }));
}
