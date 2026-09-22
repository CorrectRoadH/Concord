// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { RemoteFeedbackSchema, feedbackIdentity, type RemoteFeedback } from './feedback-schema.js';
import { ConcordError, canonical, decode, inRepositorySnapshot, type Repository } from './shared.js';

const MAX_CACHE_BYTES = 256 * 1024 * 1024;
const CachedFeedbackSchema = Schema.Struct({
  connectionId: Schema.String,
  remote: RemoteFeedbackSchema,
});
type CachedFeedback = typeof CachedFeedbackSchema.Type;

export interface FeedbackCacheSnapshot {
  readonly items: ReadonlyMap<string, CachedFeedback>;
  readonly warnings: readonly string[];
}

function pathFor(repo: Repository): string {
  return join(repo.privateDir, 'cache.sqlite');
}

function inspect(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); }
  catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined;
    throw cause;
  }
}

function assertSafeFile(path: string): void {
  const stat = inspect(path);
  if (stat === undefined) return;
  if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
  if (!stat.isFile() || stat.size > MAX_CACHE_BYTES) throw new ConcordError('InvalidCache', `${path} must be a bounded regular file`);
}

function assertDatabasePaths(repo: Repository): void {
  const path = pathFor(repo);
  const directory = inspect(repo.privateDir);
  if (directory !== undefined && (directory.isSymbolicLink() || !directory.isDirectory())) throw new ConcordError(directory.isSymbolicLink() ? 'UnsafePath' : 'InvalidCache', `${repo.privateDir} must be a real directory`);
  for (const suffix of ['', '-wal', '-shm', '-journal']) assertSafeFile(`${path}${suffix}`);
}

function openWritable(repo: Repository): DatabaseSync {
  const path = pathFor(repo);
  assertDatabasePaths(repo);
  const database = new DatabaseSync(path);
  try {
    database.exec('CREATE TABLE IF NOT EXISTS feedback_cache (identity TEXT PRIMARY KEY, connection_id TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)');
    return database;
  } catch (cause) {
    database.close();
    throw cause;
  }
}

export function readFeedbackCache(repo: Repository): FeedbackCacheSnapshot {
  return inRepositorySnapshot(repo, () => readFeedbackCacheUnderSnapshot(repo));
}
function readFeedbackCacheUnderSnapshot(repo: Repository): FeedbackCacheSnapshot {
  const path = pathFor(repo);
  assertDatabasePaths(repo);
  if (inspect(path) === undefined) return { items: new Map(), warnings: [] };
  let database: DatabaseSync;
  database = new DatabaseSync(path, { readOnly: true });
  try {
    const table = database.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'feedback_cache'").get();
    if (table === undefined) return { items: new Map(), warnings: [] };
    const rows = database.prepare('SELECT identity, connection_id, updated_at, payload FROM feedback_cache ORDER BY identity').all() as unknown as readonly {
      readonly identity: unknown;
      readonly connection_id: unknown;
      readonly updated_at: unknown;
      readonly payload: unknown;
    }[];
    const items = new Map<string, CachedFeedback>();
    for (const row of rows) {
      const value = decode(CachedFeedbackSchema, { connectionId: row.connection_id, remote: JSON.parse(String(row.payload)) }, 'feedback cache');
      const identity = feedbackIdentity(value.remote);
      if (String(row.identity) !== identity || String(row.updated_at) !== value.remote.updatedAt) throw new ConcordError('InvalidCache', 'Feedback cache index does not match its decoded payload');
      items.set(identity, value);
    }
    return { items, warnings: [] };
  } finally {
    database.close();
  }
}

/** Merge a complete successful fetch while preserving monotonic remote versions. */
export function mergeFeedbackCache(
  repo: Repository,
  connectionId: string,
  remoteItems: readonly RemoteFeedback[],
): readonly string[] {
  return inRepositorySnapshot(repo, () => mergeFeedbackCacheUnderSnapshot(repo, connectionId, remoteItems));
}
function mergeFeedbackCacheUnderSnapshot(repo: Repository, connectionId: string, remoteItems: readonly RemoteFeedback[]): readonly string[] {
  const database = openWritable(repo);
  const warnings: string[] = [];
  try {
    database.exec('BEGIN IMMEDIATE');
    try {
      const select = database.prepare('SELECT connection_id, updated_at, payload FROM feedback_cache WHERE identity = ?');
      const insert = database.prepare('INSERT OR REPLACE INTO feedback_cache (identity, connection_id, updated_at, payload) VALUES (?, ?, ?, ?)');
      for (const remote of remoteItems) {
        const identity = feedbackIdentity(remote);
        const payload = canonical(remote);
        const old = select.get(identity) as { readonly connection_id?: unknown; readonly updated_at?: unknown; readonly payload?: unknown } | undefined;
        if (old !== undefined) {
          const decoded = decode(CachedFeedbackSchema, { connectionId: old.connection_id, remote: JSON.parse(String(old.payload)) }, 'feedback cache');
          if (feedbackIdentity(decoded.remote) !== identity || decoded.remote.updatedAt !== String(old.updated_at)) throw new ConcordError('InvalidCache', 'Feedback cache index does not match its decoded payload');
          const comparison = Date.parse(remote.updatedAt) - Date.parse(decoded.remote.updatedAt);
          if (comparison < 0) continue;
          if (comparison === 0 && comparable(remote) !== comparable(decoded.remote)) {
            warnings.push(`Remote identity ${identity} returned conflicting payloads for ${remote.updatedAt}; preserved the existing cache entry.`);
            continue;
          }
          if (comparison === 0) continue;
        }
        insert.run(identity, connectionId, remote.updatedAt, payload);
      }
      database.exec('COMMIT');
    } catch (cause) {
      try { database.exec('ROLLBACK'); } catch { /* best effort */ }
      throw cause;
    }
    return warnings;
  } finally {
    database.close();
  }
}

function comparable(remote: RemoteFeedback): string {
  return canonical({ ...remote, updatedAt: new Date(Date.parse(remote.updatedAt)).toISOString() });
}
