// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { withPersistentCache } from './cache-store.js';
import type { HawdbEntry } from './hawdb-native.js';
import type { Repository } from './shared.js';

const BATCH = 1000;

export function readCodePayloads(repo: Repository, keys: readonly string[]): ReadonlyMap<string, string> {
  return withPersistentCache(repo, false, database => {
    const found = new Map<string, string>();
    if (database === undefined) return found;
    for (let index = 0; index < keys.length; index += BATCH) {
      for (const row of database.get('code_cache', keys.slice(index, index + BATCH))) found.set(row.key, row.payload);
    }
    return found;
  });
}

export function writeCodePayloads(repo: Repository, rows: readonly HawdbEntry[]): void {
  if (rows.length === 0) return;
  withPersistentCache(repo, true, database => {
    for (let index = 0; index < rows.length; index += BATCH) database!.put('code_cache', rows.slice(index, index + BATCH));
  });
}
