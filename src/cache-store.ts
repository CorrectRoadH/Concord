// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from './cache-file.js';
import { HawdbFailure, openHawdb, type HawdbDatabase } from './hawdb-native.js';
import type { Repository } from './shared.js';

const scopes = new WeakMap<Repository, { database: HawdbDatabase; writable: boolean }>();
const recoveryAllowed = new WeakSet<Repository>();

/** Only callers explicitly using writable projections may checkpoint interrupted cache writes. */
export function allowPersistentCacheRecovery(repo: Repository): void { recoveryAllowed.add(repo); }

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
    let database: HawdbDatabase;
    try { database = openHawdb(path, { readOnly: !writable, create: writable }); }
    catch (cause) {
      // The pinned engine cannot publish recovered row deltas in read-only mode.
      // An existing-only writer replays its WAL and checkpoints on close; no cache
      // deletion, schema migration or owner data mutation is authorized here.
      if (writable || !recoveryAllowed.has(repo) || !(cause instanceof HawdbFailure) || cause.code !== 'HawdbIncompatible' || !cause.message.includes('read-only recovery requires an exact published row delta')) throw cause;
      const recovered = openHawdb(path, { readOnly: false, create: false });
      recovered.close();
      database = openHawdb(path, { readOnly: true, create: false });
    }
    scope = { database, writable };
    scopes.set(repo, scope);
  }
  try { return use(scope.database); }
  finally { if (repo.snapshot === undefined) closeRepositoryCache(repo); }
}
