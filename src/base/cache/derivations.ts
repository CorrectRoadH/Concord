// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Context, Effect } from 'effect';
import { HawdbFailure, type HawdbEntry, type HawdbNamespace } from './hawdb-native.ts';
import type { CacheDerivationBatch } from '../../model/index.ts';

/** Request-local output only. It has neither a database handle nor read authority. */
export class CacheDerivations extends Context.Service<CacheDerivations, {
  readonly record: (namespace: HawdbNamespace, rows: readonly HawdbEntry[], removed?: readonly string[]) => void;
  readonly batches: Effect.Effect<readonly CacheDerivationBatch[], HawdbFailure>;
}>()('concord/base/cache/CacheDerivations') {
  static make(): CacheDerivations['Service'] {
    const pending = new Map<CacheDerivationBatch['namespace'], Map<string, string | null>>();
    let bytes = 0;
    return {
      record: (namespace, rows, removed = []) => {
        if (!['annotation_cache', 'code_cache', 'config_cache', 'query_cache'].includes(namespace) || namespace === 'query_cache' && rows.some(row => !row.key.startsWith('writing:'))) throw new HawdbFailure('HawdbUnavailable', 'A worker cannot derive remote observations or historical results');
        const name = namespace as CacheDerivationBatch['namespace'];
        const entries = pending.get(name) ?? new Map<string, string | null>();
        const changes = new Map<string, string | null>(removed.map(key => [key, null]));
        for (const row of rows) changes.set(row.key, row.payload);
        let next = bytes;
        for (const [key, value] of changes) {
          if (!entries.has(key)) next += Buffer.byteLength(key);
          next += Buffer.byteLength(value ?? '') - Buffer.byteLength(entries.get(key) ?? '');
        }
        if (next > 32 * 1024 * 1024) throw new HawdbFailure('HawdbLimit', 'One worker produced more than 32 MiB of cache derivations');
        bytes = next;
        for (const [key, value] of changes) entries.set(key, value);
        pending.set(name, entries);
      },
      batches: Effect.sync(() => [...pending].map(([namespace, changes]) => {
        const entries: HawdbEntry[] = [], removed: string[] = [];
        for (const [key, payload] of changes) {
          if (payload === null) removed.push(key);
          else entries.push({ key, payload });
        }
        return { namespace, entries, ...(removed.length ? { removed } : {}) };
      })),
    };
  }
}
