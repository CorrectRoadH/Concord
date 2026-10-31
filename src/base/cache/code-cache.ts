// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { repositoryCache } from "./cache-store.js";
import type { HawdbEntry } from "./hawdb-native.js";
import type { Repository } from "../../model/index.js";
import { readCachePayloads, writeCachePayloads } from "./cache-query.js";

export function readCodePayloads(repo: Repository, keys: readonly string[]): ReadonlyMap<string, string> {
  return readCachePayloads(repositoryCache(repo), 'code_cache', keys);
}

export function writeCodePayloads(repo: Repository, rows: readonly HawdbEntry[]): void {
  if (rows.length === 0) return;
  writeCachePayloads(repositoryCache(repo), 'code_cache', rows);
}
