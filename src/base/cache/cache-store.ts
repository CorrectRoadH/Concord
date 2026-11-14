// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import type * as HawdbNativeTypes from './hawdb-native.ts';
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from "./cache-file.ts";
import { HawdbFailure, type HawdbDatabase } from "./hawdb-native.ts";
import type { Repository } from "../../model/index.ts";
import { ensureGenericPrivateDirectorySync } from "../publication/index.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';
import { openCurrentPersistentCache } from './persistent-handle.ts';

const scopes = new WeakMap<Repository, { database: HawdbDatabase; writable: boolean; runtime: RuntimeEnvironmentSnapshot }>();
export function closeRepositoryCache(repo: Repository): void {
  const scope = scopes.get(repo);
  scopes.delete(repo);
  if (scope !== undefined) {
    scope.database.close();
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
    const database = openCurrentPersistentCache(repo.privateDir, writable, runtime);
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
  const missing = () => new HawdbFailure('HawdbUnavailable', 'Persistent cache is absent; start the workspace service or run cache rebuild');
  const parseNamespace = (namespace: HawdbNativeTypes.HawdbNamespace) => ['document_parse', 'code_parse', 'git_baseline'].includes(namespace);
  const use = <A>(namespace: HawdbNativeTypes.HawdbNamespace, writable: boolean, operation: (database: HawdbDatabase | undefined) => A): A =>
    withPersistentCache(repo, writable, database => operation(database ?? (parseNamespace(namespace) ? memory : undefined)), false, runtime);
  return {
    prepareWrite: options => withPersistentCache(repo, true, database => { if (!database) throw missing(); }, options?.create, runtime),
    get: (namespace, keys) => use(namespace, false, database => database?.get(namespace, keys) ?? []),
    scan: namespace => use(namespace, false, database => database?.scan(namespace) ?? []),
    put: (namespace, rows) => use(namespace, true, database => { if (!database) throw missing(); database.put(namespace, rows); }),
    namespaces: () => withPersistentCache(repo, false, database => database?.namespaces() ?? [], false, runtime),
  };
}
