// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { repositoryCache } from "./cache-store.ts";
import type { HawdbEntry } from "./hawdb-native.ts";
import type { Repository } from "../../model/index.ts";
import { readCachePayloads, writeCachePayloads } from "./cache-query.ts";

export function readCodePayloads(repo: Repository, keys: readonly string[]): ReadonlyMap<string, string> {
  return readCachePayloads(repositoryCache(repo), 'code_cache', keys);
}

export function writeCodePayloads(repo: Repository, rows: readonly HawdbEntry[]): void {
  if (rows.length === 0) return;
  writeCachePayloads(repositoryCache(repo), 'code_cache', rows);
}
