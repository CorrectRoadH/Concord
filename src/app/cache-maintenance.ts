import { Effect } from "effect";
import { Publication } from "../base/publication/index.js";
import { clearCache } from "../domain/tests/index.js";
import { assertCacheDatabaseSafe, cacheDatabasePath, cachePhysicalBytes, cacheRootOwnerOnly } from "../base/cache/index.js";
import { genericPrivateDirectorySync } from "../base/publication/index.js";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES, CACHE_PHYSICAL_LIMIT_BYTES } from "../base/installation/index.js";
import { openHawdb } from "../base/cache/index.js";
import { LocalRepository } from "../base/workspace/index.js";


/** Best effort: reclaim first, then release every native lock before publication. */
export function maintainCache(root: string, publication: Publication['Service']): 'below-threshold' | 'reclaimed' | 'cleared' | 'deferred' {
  try {
    const privateDir = genericPrivateDirectorySync(root), path = cacheDatabasePath(privateDir);
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path) || cachePhysicalBytes(privateDir) <= CACHE_MAINTENANCE_THRESHOLD_BYTES) return 'below-threshold';
    const database = openHawdb(path, { readOnly: false, create: false });
    let deferred: boolean;
    try { deferred = database.reclaim().deferredForActiveLeases; }
    finally { database.close(); }
    // A failed or budget-limited sweep is a deferral, never permission to clear.
    if (deferred) return 'deferred';
    if (cachePhysicalBytes(privateDir) <= CACHE_PHYSICAL_LIMIT_BYTES) return 'reclaimed';
    const repo = new LocalRepository(root, { persistentCache: 'off', reclaimPublication: false }, publication.validation);
    try {
      return repo.snapshot(() => {
        // clearCache obtains OwnerGuard and fully re-inspects before deleting.
        if (cachePhysicalBytes(privateDir) <= CACHE_PHYSICAL_LIMIT_BYTES) return 'reclaimed';
        return clearCache(repo, CACHE_PHYSICAL_LIMIT_BYTES).status === 'cleared' ? 'cleared' : 'reclaimed';
      });
    } finally { repo.close(); }
  } catch { return 'deferred'; }
}

export const runCacheMaintenance = Effect.fn('cache.maintain')(function*(root: string | undefined) {
  if (root === undefined) return;
  const publication = yield* Publication;
  return yield* Effect.sync(() => maintainCache(root, publication));
});
