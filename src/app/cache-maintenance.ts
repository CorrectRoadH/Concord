import { RuntimeEnvironment } from '../base/environment/index.ts';
import type * as WorkspaceTypes from '../base/workspace/index.ts';
import { Effect } from "effect";
import type { Publication } from "../base/publication/index.ts";
import { assertCacheDatabaseSafe, cacheDatabasePath, cachePhysicalBytes, cacheRootOwnerOnly } from "../base/cache/index.ts";
import { genericPrivateDirectorySync } from "../base/publication/index.ts";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from "../base/installation/index.ts";
import { PersistentCache } from "../base/cache/index.ts";
import { failure } from "../model/index.ts";

const reclaimedSizes = new Map<string, number>();
const growthThreshold = 256 * 1024 * 1024;

export const cacheMaintenanceNeeded = (privateDir: string) => Effect.try({
  try: () => {
    const bytes = cachePhysicalBytes(privateDir);
    if (bytes <= CACHE_MAINTENANCE_THRESHOLD_BYTES) { reclaimedSizes.delete(privateDir); return false; }
    const previous = reclaimedSizes.get(privateDir);
    return previous === undefined || bytes > previous + growthThreshold;
  },
  catch: failure,
});

/** Reclamation never discards logical data, irrespective of directory size. */
export const maintainCache = Effect.fn('maintainCache')(function*(root: string): Effect.fn.Return<'below-threshold' | 'reclaimed' | 'deferred', never, WorkspaceTypes.Workspace | Publication | PersistentCache | RuntimeEnvironment> {
  const runtime = yield* RuntimeEnvironment;
  try {
    const privateDir = genericPrivateDirectorySync(root, runtime.env), path = cacheDatabasePath(privateDir);
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path) || !(yield* cacheMaintenanceNeeded(privateDir).pipe(Effect.catch(() => Effect.succeed(false))))) return 'below-threshold';
    const cache = yield* PersistentCache;
    const deferred = yield* cache.reclaim(privateDir).pipe(
      Effect.map(result => result === undefined || result.deferredForActiveLeases),
      Effect.catch(() => Effect.succeed(true)),
    );
    // A failed or budget-limited sweep is a deferral, never permission to clear.
    if (deferred) return 'deferred';
    reclaimedSizes.set(privateDir, cachePhysicalBytes(privateDir));
    return 'reclaimed';
  } catch { return 'deferred'; }
});


export const runCacheMaintenance = Effect.fn('cache.maintain')(function*(root: string | undefined) {
  if (root === undefined) return;
  return yield* maintainCache(root);
});
