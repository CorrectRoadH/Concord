// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from 'effect';
import { withPersistentCache } from './cache-store.js';
import { RemoteFeedbackSchema, feedbackIdentity, type RemoteFeedback } from './feedback-schema.js';
import { ConcordError, canonical, decode, inRepositorySnapshot, type Repository } from './shared.js';

const CachedFeedbackSchema = Schema.Struct({ connectionId: Schema.String, remote: RemoteFeedbackSchema });
type CachedFeedback = typeof CachedFeedbackSchema.Type;

export interface FeedbackCacheSnapshot {
  readonly items: ReadonlyMap<string, CachedFeedback>;
  readonly warnings: readonly string[];
}

function decodedEntry(key: string, payload: string): CachedFeedback {
  let raw: unknown;
  try { raw = JSON.parse(payload); }
  catch { throw new ConcordError('InvalidCache', 'Feedback cache payload is not valid JSON'); }
  const value = decode(CachedFeedbackSchema, raw, 'feedback cache');
  if (feedbackIdentity(value.remote) !== key) throw new ConcordError('InvalidCache', 'Feedback cache identity does not match its decoded payload');
  return value;
}

export function readFeedbackCache(repo: Repository): FeedbackCacheSnapshot {
  return inRepositorySnapshot(repo, () => withPersistentCache(repo, false, database => {
    const items = new Map<string, CachedFeedback>();
    for (const row of database?.scan('feedback_cache') ?? []) items.set(row.key, decodedEntry(row.key, row.payload));
    return { items, warnings: [] };
  }));
}

/** One synchronous read/validate/merge/put under the same repository lease and engine handle. */
export function mergeFeedbackCache(repo: Repository, connectionId: string, remoteItems: readonly RemoteFeedback[]): readonly string[] {
  return inRepositorySnapshot(repo, () => withPersistentCache(repo, true, database => {
    const incoming = remoteItems.map(remote => decode(RemoteFeedbackSchema, remote, 'feedback fetch'));
    const keys = [...new Set(incoming.map(feedbackIdentity))];
    if (keys.length > 1000) throw new ConcordError('HawdbLimit', 'A feedback fetch exceeds the atomic 1000-identity cache batch limit');
    const current = new Map<string, CachedFeedback>();
    for (const row of keys.length === 0 ? [] : database!.get('feedback_cache', keys)) current.set(row.key, decodedEntry(row.key, row.payload));

    const warnings: string[] = [];
    const changes = new Map<string, CachedFeedback>();
    for (const remote of incoming) {
      const identity = feedbackIdentity(remote);
      const old = current.get(identity);
      if (old !== undefined) {
        const comparison = Date.parse(remote.updatedAt) - Date.parse(old.remote.updatedAt);
        if (comparison < 0) continue;
        if (comparison === 0 && comparable(remote) !== comparable(old.remote)) {
          warnings.push(`Remote identity ${identity} returned conflicting payloads for ${remote.updatedAt}; preserved the existing cache entry.`);
          continue;
        }
        if (comparison === 0) continue;
      }
      const merged: CachedFeedback = { connectionId, remote };
      current.set(identity, merged);
      changes.set(identity, merged);
    }
    if (changes.size > 0) database!.put('feedback_cache', [...changes].map(([key, value]) => ({ key, payload: canonical(value) })));
    return warnings;
  }));
}

function comparable(remote: RemoteFeedback): string {
  return canonical({ ...remote, updatedAt: new Date(Date.parse(remote.updatedAt)).toISOString() });
}
