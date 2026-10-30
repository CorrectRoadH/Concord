// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { clearCache } from "../../domain/tests/index.js";
import { assertCacheDatabaseSafe, cacheDatabasePath, cachePhysicalBytes, cacheRootOwnerOnly } from "../../base/cache/index.js";
import { genericPrivateDirectorySync } from "../../base/publication/index.js";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES, CACHE_PHYSICAL_LIMIT_BYTES } from "../../base/installation/index.js";
import { openHawdb } from "../../base/cache/index.js";
import { LocalRepository } from "../../base/workspace/index.js";

/** Best effort: reclaim first, then release every native lock before publication. */
export function maintainCache(root: string): 'below-threshold' | 'reclaimed' | 'cleared' | 'deferred' {
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
    const repo = new LocalRepository(root, { persistentCache: 'off', reclaimPublication: false });
    try {
      return repo.snapshot(() => {
        // clearCache obtains OwnerGuard and fully re-inspects before deleting.
        if (cachePhysicalBytes(privateDir) <= CACHE_PHYSICAL_LIMIT_BYTES) return 'reclaimed';
        return clearCache(repo, CACHE_PHYSICAL_LIMIT_BYTES).status === 'cleared' ? 'cleared' : 'reclaimed';
      });
    } finally { repo.close(); }
  } catch { return 'deferred'; }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  NodeRuntime.runMain(Effect.sync(() => {
    const root = process.argv[2];
    if (root !== undefined) maintainCache(root);
  }));
}
