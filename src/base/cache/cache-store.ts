// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly, inspectCacheClear, deleteInspectedCache } from "./cache-file.js";
import { HawdbFailure, openHawdb, acquireHawdbClearGuard, type HawdbDatabase } from "./hawdb-native.js";
import type { Repository } from "../../model/index.js";
import { ensureGenericPrivateDirectorySync } from "../publication/index.js";
import { requestCacheMaintenance } from "./cache-maintenance.js";

const scopes = new WeakMap<Repository, { database: HawdbDatabase; writable: boolean }>();
export function closeRepositoryCache(repo: Repository): void {
  const scope = scopes.get(repo);
  scopes.delete(repo);
  if (scope !== undefined) {
    scope.database.close();
    if (scope.writable) requestCacheMaintenance(repo);
  }
}

/** The outer LocalRepository snapshot closes the handle before its lease. Fake repositories get a short handle. */
function withPersistentCache<A>(repo: Repository, writable: boolean, use: (database: HawdbDatabase | undefined) => A): A {
  if (repo.persistentCache === 'off') {
    if (writable) throw new HawdbFailure('HawdbUnavailable', 'Persistent cache access is disabled');
    return use(undefined);
  }
  const path = cacheDatabasePath(repo.privateDir);
  const existing = assertCacheDatabaseSafe(path);
  if (!writable && (!existing || cacheRootOwnerOnly(path))) return use(undefined);
  let scope = scopes.get(repo);
  if (scope !== undefined && writable && !scope.writable) { closeRepositoryCache(repo); scope = undefined; }
  if (scope === undefined) {
    if (writable) ensureGenericPrivateDirectorySync(repo.root, repo.privateDir);
    let database: HawdbDatabase;
    try { database = openHawdb(path, { readOnly: !writable, create: writable }); }
    catch (cause) {
      if (!writable || !(cause instanceof HawdbFailure) || cause.code !== 'HawdbIncompatible') throw cause;
      const guard = acquireHawdbClearGuard(path);
      try { deleteInspectedCache(inspectCacheClear(repo.privateDir), () => guard.verify()); }
      finally { guard.close(); }
      database = openHawdb(path, { readOnly: false, create: true });
    }
    scope = { database, writable };
    scopes.set(repo, scope);
  }
  try { return use(scope.database); }
  finally { if (repo.snapshot === undefined) closeRepositoryCache(repo); }
}

/** A scoped service value; callers cannot open or retain a native handle. */
export interface RepositoryCache {
  readonly diagnostic?: () => string | undefined;
  readonly prepareWrite: () => void;
  readonly get: (namespace: import('./hawdb-native.js').HawdbNamespace, keys: readonly string[]) => readonly import('./hawdb-native.js').HawdbEntry[];
  readonly scan: (namespace: import('./hawdb-native.js').HawdbNamespace) => readonly import('./hawdb-native.js').HawdbEntry[];
  readonly put: (namespace: import('./hawdb-native.js').HawdbNamespace, rows: readonly import('./hawdb-native.js').HawdbEntry[]) => void;
  readonly namespaces: () => readonly import('./hawdb-native.js').HawdbNamespace[];
}
const owners = new WeakMap<Repository, RepositoryCache>();
const disabled = () => { throw new HawdbFailure('HawdbUnavailable', 'Persistent cache access is disabled'); };
const unavailable: RepositoryCache = { get: () => [], scan: () => [], namespaces: () => [], put: disabled, prepareWrite: disabled };
export const repositoryCache = (repo: Repository): RepositoryCache => owners.get(repo) ?? unavailable;
export function bindRepositoryCache(repo: Repository, access: RepositoryCache): () => void {
  if (owners.has(repo)) throw new HawdbFailure('HawdbBusy', 'Repository cache already has an owner');
  owners.set(repo, access);
  return () => { if (owners.get(repo) === access) { closeRepositoryCache(repo); owners.delete(repo); } };
}
export function nodeRepositoryCache(repo: Repository, memory?: HawdbDatabase): RepositoryCache {
  let diagnostic: string | undefined;
  const rebuildable = (namespace: import('./hawdb-native.js').HawdbNamespace, keys?: readonly string[]) => !['feedback_cache', 'query_cache', 'workspace_projection'].includes(namespace) || namespace === 'query_cache' && keys !== undefined && keys.every(key => key.startsWith('writing:'));
  const use = <A>(namespace: import('./hawdb-native.js').HawdbNamespace, keys: readonly string[] | undefined, writable: boolean, operation: (database: HawdbDatabase | undefined) => A): A => {
    try { return withPersistentCache(repo, writable, operation); }
    catch (cause) {
      if (!(cause instanceof HawdbFailure) || cause.code !== 'HawdbBusy' || !memory || !rebuildable(namespace, keys)) throw cause;
      diagnostic = `HawdbBusy: ${cause.message}`;
      return operation(memory);
    }
  };
  return {
    diagnostic: () => diagnostic,
    prepareWrite: () => withPersistentCache(repo, true, () => {}),
    get: (namespace, keys) => use(namespace, keys, false, database => database?.get(namespace, keys) ?? []),
    scan: namespace => use(namespace, undefined, false, database => database?.scan(namespace) ?? []),
    put: (namespace, rows) => use(namespace, rows.map(row => row.key), true, database => database!.put(namespace, rows)),
    namespaces: () => withPersistentCache(repo, false, database => database?.namespaces() ?? []),
  };
}
