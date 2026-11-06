import { Context, Effect, Layer, type Scope } from 'effect';
import { cacheDatabasePath, assertCacheDatabaseSafe, cacheRootOwnerOnly } from './cache-file.ts';
import { createMemoryHawdb, openHawdb, verifyHawdbArtifact, HawdbFailure, type HawdbDatabase, type HawdbEntry, type HawdbNamespace } from './hawdb-native.ts';
import { bindRepositoryCache, nodeRepositoryCache, repositoryCache, type RepositoryCache } from './cache-store.ts';
import type { CacheSnapshotUnavailable} from '../../model/index.ts';
import { ConcordError, type Repository } from '../../model/index.ts';
import { assertLeasePath } from '../publication/index.ts';
import { makePersistentCacheOwner } from './owner.ts';
import { CacheDerivations } from './derivations.ts';

export type ReadonlyCacheSnapshot = Readonly<Partial<Record<HawdbNamespace, readonly HawdbEntry[]>> & { unavailable?: typeof CacheSnapshotUnavailable.Type }>;
export interface CacheService {
  readonly memory: Effect.Effect<HawdbDatabase, HawdbFailure, Scope.Scope>;
}
export interface PersistentCacheService {
  readonly verifyArtifact: Effect.Effect<void, HawdbFailure>;
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
  readonly read: (privateDir: string, namespace: HawdbNamespace, keys?: readonly string[]) => Effect.Effect<readonly HawdbEntry[], HawdbFailure>;
  readonly update: (privateDir: string, namespace: HawdbNamespace, key: string, update: (prior: string | undefined) => string) => Effect.Effect<void, HawdbFailure | ConcordError>;
  readonly open: (privateDir: string) => Effect.Effect<HawdbDatabase | undefined, HawdbFailure, Scope.Scope>;
}
const cacheFailure = (cause: unknown): HawdbFailure => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause));

/** In-memory handles cannot grant access to a persistent namespace. */
export class Cache extends Context.Service<Cache, CacheService>()('concord/base/cache/Cache') {
  static readonly layer = Layer.effect(Cache, Effect.gen(function*() {
    let database: HawdbDatabase | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => database?.close()));
    return Cache.of({ memory: Effect.try({ try: () => database ??= createMemoryHawdb(), catch: cacheFailure }) });
  }));
}

/** An immutable observation supplied by the owner; no handle or write method. */
export class CacheSnapshot extends Context.Service<CacheSnapshot, {
  readonly entries: (namespace: HawdbNamespace) => readonly HawdbEntry[];
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
}>()('concord/base/cache/CacheSnapshot') {
  static layer(snapshot: ReadonlyCacheSnapshot = {}) {
    const { unavailable: observed, ...rows } = snapshot;
    const unavailable = observed ? Object.freeze({ ...observed }) : undefined;
    const copy = Object.fromEntries(Object.entries(rows).map(([namespace, entries]) => [namespace, Object.freeze(entries.map(entry => Object.freeze({ ...entry })))])) as ReadonlyCacheSnapshot;
    const indexes = new Map(Object.entries(rows).map(([namespace, entries]) => [namespace, new Map(entries.map(row => [row.key, Object.freeze({ ...row })]))]));
    const persistent = <A>(read: () => A): A => { if (unavailable) throw new HawdbFailure(unavailable.code, unavailable.message); return read(); };
    return Layer.succeed(CacheSnapshot, CacheSnapshot.of({ entries: namespace => persistent(() => copy[namespace] ?? []),
        attach: repo => Effect.gen(function*() {
          const derivations = yield* Effect.serviceOption(CacheDerivations);
          const access: RepositoryCache = {
            prepareWrite: () => {
              if (derivations._tag === 'Some') return;
              throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access');
            },
            get: (namespace, keys) => persistent(() => keys.flatMap(key => { const row = indexes.get(namespace)?.get(key); return row ? [row] : []; })),
            scan: namespace => persistent(() => copy[namespace] ?? []),
            namespaces: () => persistent(() => Object.keys(rows) as HawdbNamespace[]),
            put: (namespace, entries) => {
              if (derivations._tag === 'Some') { derivations.value.record(namespace, entries); return; }
              throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access');
            },
          };
          yield* Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, access), catch: cacheFailure }), release => Effect.sync(release));
        }),
    }));
  }
}

/** Native ownership is authoritative. Contention falls back to memory at callers. */
export class PersistentCache extends Context.Service<PersistentCache, PersistentCacheService>()('concord/base/cache/PersistentCache') {
  static owner(privateDir: string) { return makePersistentCacheOwner(privateDir); }
  static readonly repository = repositoryCache;
  static withView<A>(owner: Repository, view: Repository, use: () => A): A {
    const release = bindRepositoryCache(view, repositoryCache(owner));
    try { return use(); } finally { release(); }
  }
  static readonly layer = Layer.succeed(PersistentCache, PersistentCache.of({
    verifyArtifact: Effect.try({ try: verifyHawdbArtifact, catch: cacheFailure }),
    attach: repo => Effect.gen(function*() {
      const cache = yield* Effect.serviceOption(Cache);
      const memory = cache._tag === 'Some' ? yield* cache.value.memory.pipe(Effect.catch(() => Effect.succeed(undefined))) : undefined;
      yield* Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, nodeRepositoryCache(repo, memory)), catch: cacheFailure }), release => Effect.sync(release));
    }),
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
