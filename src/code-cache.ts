// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { withPersistentCache } from './cache-store.js';
import type { HawdbEntry } from './hawdb-native.js';
import type { Repository } from './shared.js';
import { readCachePayloads, writeCachePayloads } from './cache-query.js';

export function readCodePayloads(repo: Repository, keys: readonly string[]): ReadonlyMap<string, string> {
  return withPersistentCache(repo, false, database => {
    return database === undefined ? new Map<string, string>() : readCachePayloads(database, 'code_cache', keys);
  });
}

export function writeCodePayloads(repo: Repository, rows: readonly HawdbEntry[]): void {
  if (rows.length === 0) return;
  withPersistentCache(repo, true, database => {
    writeCachePayloads(database!, 'code_cache', rows);
  });
}
