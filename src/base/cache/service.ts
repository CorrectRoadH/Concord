import { Context, Effect, Layer, type Scope } from 'effect';
import { cacheDatabasePath, assertCacheDatabaseSafe, cacheRootOwnerOnly } from './cache-file.ts';
import { createMemoryHawdb, openHawdb, verifyHawdbArtifact, HawdbFailure, type HawdbDatabase, type HawdbEntry, type HawdbNamespace } from './hawdb-native.ts';
import { bindRepositoryCache, nodeRepositoryCache, repositoryCache, type RepositoryCache } from './cache-store.ts';
import type { CacheSnapshotUnavailable} from '../../model/index.ts';
import { ConcordError, digest, type Repository } from '../../model/index.ts';
import { assertLeasePath } from '../publication/index.ts';
import { makePersistentCacheOwner } from './owner.ts';
import { RuntimeEnvironment } from '../environment/index.ts';
import { CacheDerivations } from './derivations.ts';
import { ContentCacheOwner, withContentCacheOwner } from './content-cache-owner.ts';
import { WorkspaceContext } from '../workspace/index.ts';
import { OperationCache } from './operation-cache.ts';

export type ReadonlyCacheSnapshot = Readonly<Partial<Record<HawdbNamespace, readonly HawdbEntry[]>> & { unavailable?: typeof CacheSnapshotUnavailable.Type }>;
type ParseNamespace = Extract<HawdbNamespace, 'document_parse' | 'code_parse' | 'git_baseline'>;
export interface CacheService {
  readonly get: (namespace: ParseNamespace, keys: readonly string[]) => Effect.Effect<readonly HawdbEntry[], HawdbFailure, WorkspaceContext>;
  readonly put: (namespace: ParseNamespace, rows: readonly HawdbEntry[]) => Effect.Effect<void, HawdbFailure, WorkspaceContext>;
}
export interface PersistentCacheService {
  readonly verifyArtifact: Effect.Effect<void, HawdbFailure>;
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
  readonly read: (privateDir: string, namespace: HawdbNamespace, keys?: readonly string[]) => Effect.Effect<readonly HawdbEntry[], HawdbFailure>;
  readonly update: (privateDir: string, namespace: HawdbNamespace, key: string, update: (prior: string | undefined) => string) => Effect.Effect<void, HawdbFailure | ConcordError>;
}
const cacheFailure = (cause: unknown): HawdbFailure => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause));
const memoryOwners = new WeakMap<CacheService, Effect.Effect<HawdbDatabase, HawdbFailure>>();

/** In-memory handles cannot grant access to a persistent namespace. */
export class Cache extends Context.Service<Cache, CacheService>()('concord/base/cache/Cache') {
  static readonly parseOwner = Effect.acquireRelease(Effect.sync(() => new ContentCacheOwner()), owner => Effect.sync(() => owner.close()));
  static readonly withParseCache = withContentCacheOwner;
  static readonly layer = Layer.effect(Cache, Effect.gen(function*() {
    const runtime = yield* RuntimeEnvironment;
    let database: HawdbDatabase | undefined;
    let closed = false;
    yield* Effect.addFinalizer(() => Effect.sync(() => {
      closed = true;
      database?.close();
      database = undefined;
    }));
    const memory = Effect.try({ try: () => {
      if (closed) throw new HawdbFailure('HawdbClosed', 'Memory cache scope is closed');
      return database ??= createMemoryHawdb(runtime);
    }, catch: cacheFailure });
    const service = Cache.of({
      get: Effect.fn('Cache.get')(function*(namespace: ParseNamespace, keys: readonly string[]) {
        const workspace = yield* WorkspaceContext;
        if (workspace.cache === 'off') return [];
        const database = yield* memory;
        const prefix = `${digest(workspace.root)}:`;
        return yield* Effect.try({ try: () => database.get(namespace, keys.map(key => `${prefix}${key}`)).map(row => ({ key: row.key.slice(prefix.length), payload: row.payload })), catch: cacheFailure });
      }),
      put: Effect.fn('Cache.put')(function*(namespace: ParseNamespace, rows: readonly HawdbEntry[]) {
        const workspace = yield* WorkspaceContext;
        if (workspace.cache === 'off') return;
        const database = yield* memory;
        const prefix = `${digest(workspace.root)}:`;
        yield* Effect.try({ try: () => database.put(namespace, rows.map(row => ({ key: `${prefix}${row.key}`, payload: row.payload }))), catch: cacheFailure });
      }),
    });
    memoryOwners.set(service, memory);
    return service;
  }));
}

/** An immutable observation supplied by the owner; no handle or write method. */
export class CacheSnapshot extends Context.Service<CacheSnapshot, {
  readonly entries: (namespace: HawdbNamespace) => Effect.Effect<readonly HawdbEntry[], HawdbFailure>;
  readonly get: (namespace: HawdbNamespace, keys: readonly string[]) => Effect.Effect<readonly HawdbEntry[], HawdbFailure>;
  readonly attach: (repo: Repository) => Effect.Effect<void, HawdbFailure, Scope.Scope>;
}>()('concord/base/cache/CacheSnapshot') {
  static layer(snapshot: ReadonlyCacheSnapshot = {}) {
    const { unavailable: observed, ...rows } = snapshot;
    const unavailable = observed ? Object.freeze({ ...observed }) : undefined;
    const copy = Object.fromEntries(Object.entries(rows).map(([namespace, entries]) => [namespace, Object.freeze(entries.map(entry => Object.freeze({ ...entry })))])) as ReadonlyCacheSnapshot;
    const indexes = new Map(Object.entries(rows).map(([namespace, entries]) => [namespace, new Map(entries.map(row => [row.key, Object.freeze({ ...row })]))]));
    const persistent = <A>(read: () => A): A => { if (unavailable) throw new HawdbFailure(unavailable.code, unavailable.message); return read(); };
    return Layer.succeed(CacheSnapshot, CacheSnapshot.of({ entries: namespace => Effect.try({ try: () => persistent(() => copy[namespace] ?? []), catch: cacheFailure }),
        get: (namespace, keys) => Effect.try({ try: () => persistent(() => keys.flatMap(key => { const row = indexes.get(namespace)?.get(key); return row ? [row] : []; })), catch: cacheFailure }),
        attach: repo => Effect.gen(function*() {
          const derivations = yield* Effect.serviceOption(CacheDerivations);
          const access: RepositoryCache = {
            prepareWrite: () => {
              persistent(() => undefined);
              if (derivations._tag === 'Some') return;
              throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access');
            },
            get: (namespace, keys) => persistent(() => keys.flatMap(key => { const row = indexes.get(namespace)?.get(key); return row ? [row] : []; })),
            scan: namespace => persistent(() => copy[namespace] ?? []),
            namespaces: () => persistent(() => Object.keys(rows) as HawdbNamespace[]),
            put: (namespace, entries) => {
              persistent(() => undefined);
              if (derivations._tag === 'Some') { derivations.value.record(namespace, entries); return; }
              throw new HawdbFailure('HawdbUnavailable', 'A cache snapshot cannot grant persistent write access');
            },
          };
          yield* Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, access), catch: cacheFailure }), release => Effect.sync(release));
        }),
    }));
  }
}

/** Native ownership and its failures remain authoritative. */
export class PersistentCache extends Context.Service<PersistentCache, PersistentCacheService>()('concord/base/cache/PersistentCache') {
  static owner(privateDir: string) { return makePersistentCacheOwner(privateDir); }
  static readonly repository = repositoryCache;
  static withView<A>(owner: Repository, view: Repository, use: () => A): A {
    const unbind = bindRepositoryCache(view, repositoryCache(owner));
    let released = false;
    const release = () => { if (!released) { released = true; unbind(); } };
    try {
      const value = use();
      if (value instanceof Promise) return value.finally(release) as A;
      release();
      return value;
    } catch (cause) { release(); throw cause; }
  }
  static readonly layer = Layer.effect(PersistentCache, Effect.gen(function*() {
    const runtime = yield* RuntimeEnvironment;
    return PersistentCache.of({
      verifyArtifact: Effect.try({ try: () => verifyHawdbArtifact(runtime), catch: cacheFailure }),
      attach: repo => Effect.gen(function*() {
        const cache = yield* Effect.serviceOption(Cache);
        const ownedMemory = cache._tag === 'Some' ? memoryOwners.get(cache.value) : undefined;
        const memory = ownedMemory === undefined ? undefined : yield* ownedMemory;
        yield* Effect.acquireRelease(Effect.try({ try: () => bindRepositoryCache(repo, nodeRepositoryCache(repo, memory, runtime)), catch: cacheFailure }), release => Effect.sync(release));
      }),
      read: (privateDir, namespace, keys) => Effect.scoped(Effect.gen(function*() {
        const operation = yield* Effect.serviceOption(OperationCache);
        if (operation._tag === 'Some') {
          if (operation.value.privateDir !== privateDir) return yield* Effect.fail(new HawdbFailure('HawdbUnavailable', 'Open a source snapshot for the requested cache workspace'));
          return yield* Effect.try({ try: () => operation.value.read(namespace, keys), catch: cacheFailure });
        }
        const database = yield* Effect.acquireRelease(Effect.try({ try: () => {
          const path = cacheDatabasePath(privateDir);
          assertLeasePath(path);
          return !assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path) ? undefined : openHawdb(path, { readOnly: true, create: false }, runtime);
        }, catch: cacheFailure }), database => Effect.sync(() => database?.close()));
        return yield* Effect.try({ try: () => database === undefined ? [] : keys === undefined ? database.scan(namespace) : database.get(namespace, keys), catch: cacheFailure });
      })),
      update: (privateDir, namespace, key, update) => Effect.scoped(Effect.gen(function*() {
        const operation = yield* Effect.serviceOption(OperationCache);
        if (operation._tag === 'Some') {
          if (operation.value.privateDir !== privateDir) return yield* Effect.fail(new HawdbFailure('HawdbUnavailable', 'Open a source snapshot for the requested cache workspace'));
          return yield* Effect.try({ try: () => operation.value.update(namespace, key, update), catch: cause => cause instanceof ConcordError ? cause : cacheFailure(cause) });
        }
        const database = yield* Effect.acquireRelease(Effect.try({ try: () => {
          const path = cacheDatabasePath(privateDir);
          assertLeasePath(path); assertCacheDatabaseSafe(path);
          return openHawdb(path, { readOnly: false, create: true }, runtime);
        }, catch: cacheFailure }), database => Effect.sync(() => database.close()));
        yield* Effect.try({ try: () => {
          const payload = update(database.get(namespace, [key])[0]?.payload);
          database.put(namespace, [{ key, payload }]);
        }, catch: cause => cause instanceof ConcordError ? cause : cacheFailure(cause) });
      })),
    });
  }));
}
