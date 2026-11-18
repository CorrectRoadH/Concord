// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { repositoryCache } from "./cache-store.ts";
import type { HawdbEntry } from "./hawdb-native.ts";
import type { Repository } from "../../model/index.ts";

/** A full source scan needs the previous paths even when its new source set is empty. */
export function readCodePayloads(repo: Repository): Map<string, string> {
  return new Map(repositoryCache(repo).scan('code_cache')
    .filter(row => row.key.startsWith('source:')).map(row => [row.key, row.payload]));
}

export function writeCodePayloads(repo: Repository, rows: readonly HawdbEntry[], removed: readonly string[]): void {
  if (rows.length || removed.length) repositoryCache(repo).reconcile('code_cache', rows, removed);
}
