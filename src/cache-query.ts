// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import type { HawdbDatabase, HawdbEntry, HawdbLimits, HawdbNamespace } from './hawdb-native.js';

/** Query-local selection only. The engine bounds namespace rows and bytes. */
export function readCachePayloads(database: HawdbDatabase, namespace: HawdbNamespace, keys: readonly string[]): ReadonlyMap<string, string> {
  if (keys.length === 0) return new Map();
  const requested = new Set(keys);
  // The pinned bridge executes one SQL query per get key. A namespace scan
  // avoids repeated planning and row traversal for a collection-sized read.
  const entries = keys.length > 32 ? database.scan(namespace) : database.get(namespace, keys);
  return new Map(entries.filter(entry => requested.has(entry.key)).map(entry => [entry.key, entry.payload]));
}

/** Respect both native batch limits; a large collection is not a cache failure. */
export function writeCachePayloads(database: HawdbDatabase, namespace: HawdbNamespace, entries: readonly HawdbEntry[], limits?: HawdbLimits): void {
  let batch: HawdbEntry[] = [];
  let bytes = 0;
  const maxEntries = Math.min(1000, limits?.maxEntries ?? 1000);
  const maxBytes = Math.min(16 * 1024 * 1024, limits?.maxBytes ?? 16 * 1024 * 1024);
  for (const entry of entries) {
    const size = Buffer.byteLength(namespace) + Buffer.byteLength(entry.key) + Buffer.byteLength(entry.payload);
    if (batch.length > 0 && (batch.length === maxEntries || bytes + size > maxBytes)) {
      database.put(namespace, batch, limits);
      batch = []; bytes = 0;
    }
    batch.push(entry); bytes += size;
  }
  if (batch.length > 0) database.put(namespace, batch, limits);
}
