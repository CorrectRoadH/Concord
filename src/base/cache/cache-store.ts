// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import type * as HawdbNativeTypes from './hawdb-native.ts';
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly, inspectCacheClear, deleteInspectedCache } from "./cache-file.ts";
import { HawdbFailure, openHawdb, acquireHawdbClearGuard, type HawdbDatabase } from "./hawdb-native.ts";
import type { Repository } from "../../model/index.ts";
import { ensureGenericPrivateDirectorySync } from "../publication/index.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';
import { requestCacheMaintenance } from "./cache-maintenance.ts";

const scopes = new WeakMap<Repository, { database: HawdbDatabase; writable: boolean; runtime: RuntimeEnvironmentSnapshot }>();
export function closeRepositoryCache(repo: Repository): void {
  const scope = scopes.get(repo);
  scopes.delete(repo);
  if (scope !== undefined) {
    scope.database.close();
    if (scope.writable) requestCacheMaintenance(repo, scope.runtime);
  }
}

/** The outer source snapshot closes the handle before its lease. Fake repositories get a short handle. */
function withPersistentCache<A>(repo: Repository, writable: boolean, use: (database: HawdbDatabase | undefined) => A, create = false, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})): A {
  if (repo.persistentCache === 'off') {
    if (writable) throw new HawdbFailure('HawdbUnavailable', 'Persistent cache access is disabled');
    return use(undefined);
  }
  const path = cacheDatabasePath(repo.privateDir);
  const existing = assertCacheDatabaseSafe(path);
  if (!existing && !create) return use(undefined);
  if (!writable && (!existing || cacheRootOwnerOnly(path))) return use(undefined);
  let scope = scopes.get(repo);
  if (scope !== undefined && writable && !scope.writable) { closeRepositoryCache(repo); scope = undefined; }
  if (scope === undefined) {
    if (create) ensureGenericPrivateDirectorySync(repo.root, repo.privateDir, runtime.env);
    let database: HawdbDatabase;
    try { database = openHawdb(path, { readOnly: !writable, create }, runtime); }
    catch (cause) {
      if (!create || !(cause instanceof HawdbFailure) || cause.code !== 'HawdbIncompatible') throw cause;
      const guard = acquireHawdbClearGuard(path, runtime);
      try { deleteInspectedCache(inspectCacheClear(repo.privateDir), () => guard.verify()); }
      finally { guard.close(); }
      database = openHawdb(path, { readOnly: false, create: true }, runtime);
    }
    scope = { database, writable, runtime };
    scopes.set(repo, scope);
  }
  try { return use(scope.database); }
  finally { if (repo.snapshot === undefined) closeRepositoryCache(repo); }
}

/** A scoped service value; callers cannot open or retain a native handle. */
export interface RepositoryCache {
  readonly diagnostic?: () => string | undefined;
  readonly prepareWrite: (options?: { readonly create: boolean }) => void;
  readonly get: (namespace: HawdbNativeTypes.HawdbNamespace, keys: readonly string[]) => readonly HawdbNativeTypes.HawdbEntry[];
  readonly scan: (namespace: HawdbNativeTypes.HawdbNamespace) => readonly HawdbNativeTypes.HawdbEntry[];
  readonly put: (namespace: HawdbNativeTypes.HawdbNamespace, rows: readonly HawdbNativeTypes.HawdbEntry[]) => void;
  readonly namespaces: () => readonly HawdbNativeTypes.HawdbNamespace[];
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
export function nodeRepositoryCache(repo: Repository, memory?: HawdbDatabase, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})): RepositoryCache {
  let diagnostic: string | undefined;
  const missing = () => new HawdbFailure('HawdbUnavailable', 'Persistent cache is absent; start the workspace service or run cache rebuild');
  const parseNamespace = (namespace: HawdbNativeTypes.HawdbNamespace) => ['document_parse', 'code_parse', 'git_baseline'].includes(namespace);
  const rebuildable = (namespace: HawdbNativeTypes.HawdbNamespace, keys?: readonly string[]) => !['feedback_cache', 'query_cache', 'workspace_projection'].includes(namespace) || namespace === 'query_cache' && keys !== undefined && keys.every(key => key.startsWith('writing:'));
  const use = <A>(namespace: HawdbNativeTypes.HawdbNamespace, keys: readonly string[] | undefined, writable: boolean, operation: (database: HawdbDatabase | undefined) => A): A => {
    try { return withPersistentCache(repo, writable, database => operation(database ?? (parseNamespace(namespace) ? memory : undefined)), false, runtime); }
    catch (cause) {
      if (!(cause instanceof HawdbFailure) || cause.code !== 'HawdbBusy' || !rebuildable(namespace, keys)) throw cause;
      diagnostic = `HawdbBusy: ${cause.message}`;
      if (memory && parseNamespace(namespace)) return operation(memory);
      // Derived rows have no memory table. Their existing unavailable-cache
      // path recomputes from source while retaining the busy diagnostic.
      throw cause;
    }
  };
  return {
    diagnostic: () => diagnostic,
    prepareWrite: options => withPersistentCache(repo, true, database => { if (!database) throw missing(); }, options?.create, runtime),
    get: (namespace, keys) => use(namespace, keys, false, database => database?.get(namespace, keys) ?? []),
    scan: namespace => use(namespace, undefined, false, database => database?.scan(namespace) ?? []),
    put: (namespace, rows) => use(namespace, rows.map(row => row.key), true, database => { if (!database) throw missing(); database.put(namespace, rows); }),
    namespaces: () => withPersistentCache(repo, false, database => database?.namespaces() ?? [], false, runtime),
  };
}
