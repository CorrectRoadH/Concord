// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assertCacheDatabaseSafe, cacheDatabasePath } from './cache-file.js';
import type { Repository } from './shared.js';

export function readCodePayloads(repo: Repository, keys: readonly string[]): ReadonlyMap<string, string> {
  const path = cacheDatabasePath(repo.privateDir);
  assertCacheDatabaseSafe(path);
  if (!existsSync(path) || keys.length === 0) return new Map();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'code_cache'").get() === undefined) return new Map();
    const select = db.prepare('SELECT payload FROM code_cache WHERE cache_key = ?');
    const found = new Map<string, string>();
    for (const key of keys) {
      const row = select.get(key) as { payload?: unknown } | undefined;
      if (row?.payload !== undefined) found.set(key, String(row.payload));
    }
    return found;
  } finally { db.close(); }
}

export function writeCodePayloads(repo: Repository, rows: readonly { readonly key: string; readonly payload: string }[]): void {
  if (rows.length === 0) return;
  const path = cacheDatabasePath(repo.privateDir);
  assertCacheDatabaseSafe(path);
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS code_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.exec('BEGIN IMMEDIATE');
    try {
      const insert = db.prepare('INSERT OR REPLACE INTO code_cache (cache_key, payload) VALUES (?, ?)');
      for (const row of rows) insert.run(row.key, row.payload);
      db.exec('COMMIT');
    } catch (cause) {
      try { db.exec('ROLLBACK'); } catch { /* best effort */ }
      throw cause;
    }
  } finally { db.close(); }
}
