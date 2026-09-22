// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/trace-code-ownership.md
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { assertCacheDatabaseSafe, cacheDatabasePath } from './cache-file.js';
import { canonical, decode, objectDigest, ProjectSchema, type ProjectConfig } from './shared.js';
import { typescriptPackageVersion } from './typescript-host.js';

const CachedConfigSchema = Schema.Struct({ config: ProjectSchema, digest: Schema.String });
const pending = new Map<string, { readonly sourceDigest: string; readonly config: ProjectConfig }>();

function parserVersion(): string {
  return `typescript-ast/${typescriptPackageVersion()}/concord-config-parse/v1`;
}
function cacheKey(privateDir: string, sourceDigest: string): string {
  return objectDigest({ privateDir, parser: parserVersion(), sourceDigest });
}

/** Missing, corrupt, or unsafe cache is a miss. Opening a repository must still parse source. */
export function readCachedProjectConfig(privateDir: string, sourceDigest: string): ProjectConfig | undefined {
  try {
    const path = cacheDatabasePath(privateDir);
    assertCacheDatabaseSafe(path);
    if (!existsSync(path)) return undefined;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'config_cache'").get() === undefined) return undefined;
      const row = db.prepare('SELECT payload FROM config_cache WHERE cache_key = ?').get(cacheKey(privateDir, sourceDigest)) as { payload?: unknown } | undefined;
      if (row?.payload === undefined) return undefined;
      const value = decode(CachedConfigSchema, JSON.parse(String(row.payload)), 'config cache');
      if (value.digest !== objectDigest(value.config)) return undefined;
      return value.config;
    } finally { db.close(); }
  } catch { return undefined; }
}

export function noteConfigProjection(privateDir: string, sourceDigest: string, config: ProjectConfig): void {
  pending.set(privateDir, { sourceDigest, config });
}

export function persistNotedConfig(privateDir: string): void {
  const noted = pending.get(privateDir);
  if (noted === undefined) return;
  const path = cacheDatabasePath(privateDir);
  assertCacheDatabaseSafe(path);
  const payload = canonical({ config: noted.config, digest: objectDigest(noted.config) });
  const db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS config_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR REPLACE INTO config_cache (cache_key, payload) VALUES (?, ?)').run(cacheKey(privateDir, noted.sourceDigest), payload);
      db.exec('COMMIT');
    } catch (cause) {
      try { db.exec('ROLLBACK'); } catch { /* best effort */ }
      throw cause;
    }
  } finally { db.close(); }
  pending.delete(privateDir);
}
