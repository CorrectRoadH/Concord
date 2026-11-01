import { Effect } from "effect";
import { Publication } from "../base/publication/index.js";
import { clearCache } from "../domain/tests/index.js";
import { assertCacheDatabaseSafe, cacheDatabasePath, cachePhysicalBytes, cacheRootOwnerOnly } from "../base/cache/index.js";
import { genericPrivateDirectorySync } from "../base/publication/index.js";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES, CACHE_PHYSICAL_LIMIT_BYTES } from "../base/installation/index.js";
import { PersistentCache } from "../base/cache/index.js";
import { openWriteRepository } from "../base/workspace/index.js";
import { failure } from "../model/index.js";

export const cacheMaintenanceNeeded = (privateDir: string) => Effect.try({
  try: () => cachePhysicalBytes(privateDir) > CACHE_MAINTENANCE_THRESHOLD_BYTES,
  catch: failure,
});

/** Best effort: reclaim first, then release every native lock before publication. */
export const maintainCache = Effect.fn('maintainCache')(function*(root: string): Effect.fn.Return<'below-threshold' | 'reclaimed' | 'cleared' | 'deferred', never, import('../base/workspace/index.js').Workspace | Publication | PersistentCache> {
  try {
    const privateDir = genericPrivateDirectorySync(root), path = cacheDatabasePath(privateDir);
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path) || cachePhysicalBytes(privateDir) <= CACHE_MAINTENANCE_THRESHOLD_BYTES) return 'below-threshold';
    const cache = yield* PersistentCache;
    const deferred = yield* Effect.scoped(Effect.gen(function*() {
      const database = yield* cache.open(privateDir);
      if (database === undefined) return true;
      return yield* Effect.try({ try: () => database.reclaim().deferredForActiveLeases, catch: cause => cause });
    })).pipe(Effect.catch(() => Effect.succeed(true)));
    // A failed or budget-limited sweep is a deferral, never permission to clear.
    if (deferred) return 'deferred';
    if (cachePhysicalBytes(privateDir) <= CACHE_PHYSICAL_LIMIT_BYTES) return 'reclaimed';
    return yield* Effect.scoped(Effect.gen(function*() {
      const repo = yield* openWriteRepository(root, { persistentCache: 'off', reclaimPublication: false });
      return yield* Effect.try({ try: () => repo.snapshot(() => {
        if (cachePhysicalBytes(privateDir) <= CACHE_PHYSICAL_LIMIT_BYTES) return 'reclaimed' as const;
        return clearCache(repo, CACHE_PHYSICAL_LIMIT_BYTES).status === 'cleared' ? 'cleared' as const : 'reclaimed' as const;
      }), catch: cause => cause });
    })).pipe(Effect.catch(() => Effect.succeed('deferred' as const)));
  } catch { return 'deferred'; }
});


export const runCacheMaintenance = Effect.fn('cache.maintain')(function*(root: string | undefined) {
  if (root === undefined) return;
  return yield* maintainCache(root);
});
