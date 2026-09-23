// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from './cache-file.js';
import { openHawdb, type HawdbDatabase } from './hawdb-native.js';
import type { Repository } from './shared.js';

const scopes = new WeakMap<Repository, { database: HawdbDatabase; writable: boolean }>();

export function closeRepositoryCache(repo: Repository): void {
  const scope = scopes.get(repo);
  scopes.delete(repo);
  scope?.database.close();
}

/** The outer LocalRepository snapshot closes the handle before its lease. Fake repositories get a short handle. */
export function withPersistentCache<A>(repo: Repository, writable: boolean, use: (database: HawdbDatabase | undefined) => A): A {
  const path = cacheDatabasePath(repo.privateDir);
  const existing = assertCacheDatabaseSafe(path);
  if (!writable && (!existing || cacheRootOwnerOnly(path))) return use(undefined);
  let scope = scopes.get(repo);
  if (scope !== undefined && writable && !scope.writable) { closeRepositoryCache(repo); scope = undefined; }
  if (scope === undefined) {
    scope = { database: openHawdb(path, { readOnly: !writable, create: writable }), writable };
    scopes.set(repo, scope);
  }
  try { return use(scope.database); }
  finally { if (repo.snapshot === undefined) closeRepositoryCache(repo); }
}
