import { Context, Effect, Layer, type Scope } from 'effect';
import { cacheDatabasePath, assertCacheDatabaseSafe, cacheRootOwnerOnly } from './cache-file.js';
import { createMemoryHawdb, openHawdb, HawdbFailure, type HawdbDatabase, type HawdbEntry, type HawdbNamespace } from './hawdb-native.js';
import { bindRepositoryCache, nodeRepositoryCache, repositoryCache, type RepositoryCache } from './cache-store.js';
import { ConcordError, type Repository } from '../../model/index.js';
import { assertLeasePath } from '../publication/index.js';

export type ReadonlyCacheSnapshot = Readonly<Partial<Record<HawdbNamespace, readonly HawdbEntry[]>>>;
export interface CacheService {
  readonly memory: Effect.Effect<HawdbDatabase, HawdbFailure, Scope.Scope>;
}
export interface PersistentCacheService {
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
  readonly read: (privateDir: string, namespace: HawdbNamespace, keys?: readonly string[]) => Effect.Effect<readonly HawdbEntry[], HawdbFailure>;
  readonly update: (privateDir: string, namespace: HawdbNamespace, key: string, update: (prior: string | undefined) => string) => Effect.Effect<void, HawdbFailure | ConcordError>;
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
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
}>()('concord/base/cache/CacheSnapshot') {
  static layer(snapshot: ReadonlyCacheSnapshot = {}) {
    const copy = Object.fromEntries(Object.entries(snapshot).map(([namespace, entries]) => [namespace, Object.freeze(entries.map(entry => Object.freeze({ ...entry })))])) as ReadonlyCacheSnapshot;
    const access: RepositoryCache = {
      prepareWrite: () => { throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access'); },
      get: (namespace, keys) => (copy[namespace] ?? []).filter(row => keys.includes(row.key)),
      scan: namespace => copy[namespace] ?? [],
      namespaces: () => Object.keys(copy) as HawdbNamespace[],
      put: () => { throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access'); },
    };
    return Layer.succeed(CacheSnapshot, CacheSnapshot.of({ entries: namespace => copy[namespace] ?? [],
      attach: repo => Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, access), catch: cacheFailure }), release => Effect.sync(release)).pipe(Effect.asVoid),
    }));
  }
}

/** Native ownership is authoritative. Contention falls back to memory at callers. */
export class PersistentCache extends Context.Service<PersistentCache, PersistentCacheService>()('concord/base/cache/PersistentCache') {
  static readonly repository = repositoryCache;
  static withView<A>(owner: Repository, view: Repository, use: () => A): A {
    const release = bindRepositoryCache(view, repositoryCache(owner));
    try { return use(); } finally { release(); }
  }
  static readonly layer = Layer.succeed(PersistentCache, PersistentCache.of({
    attach: repo => Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, nodeRepositoryCache(repo)), catch: cacheFailure }), release => Effect.sync(release)).pipe(Effect.asVoid),
    read: (privateDir, namespace, keys) => Effect.scoped(Effect.gen(function*() {
      const database = yield* Effect.acquireRelease(Effect.try({ try: () => {
        const path = cacheDatabasePath(privateDir);
        assertLeasePath(path);
        return !assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path) ? undefined : openHawdb(path, { readOnly: true, create: false });
      }, catch: cacheFailure }), database => Effect.sync(() => database?.close()));
      return yield* Effect.try({ try: () => database === undefined ? [] : keys === undefined ? database.scan(namespace) : database.get(namespace, keys), catch: cacheFailure });
    })),
    update: (privateDir, namespace, key, update) => Effect.scoped(Effect.gen(function*() {
      const database = yield* Effect.acquireRelease(Effect.try({ try: () => {
        const path = cacheDatabasePath(privateDir);
        assertLeasePath(path); assertCacheDatabaseSafe(path);
        return openHawdb(path, { readOnly: false, create: true });
      }, catch: cacheFailure }), database => Effect.sync(() => database.close()));
      yield* Effect.try({ try: () => {
        const payload = update(database.get(namespace, [key])[0]?.payload);
        database.put(namespace, [{ key, payload }]);
      }, catch: cause => cause instanceof ConcordError ? cause : cacheFailure(cause) });
    })),
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
