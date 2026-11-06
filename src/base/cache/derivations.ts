// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Context } from 'effect';
import { HawdbFailure, type HawdbEntry, type HawdbNamespace } from './hawdb-native.ts';
import type { CacheDerivationBatch } from '../../model/index.ts';

/** Request-local output only. It has neither a database handle nor read authority. */
export class CacheDerivations extends Context.Service<CacheDerivations, {
  readonly record: (namespace: HawdbNamespace, rows: readonly HawdbEntry[]) => void;
  readonly batches: () => readonly CacheDerivationBatch[];
}>()('concord/base/cache/CacheDerivations') {
  static make(): CacheDerivations['Service'] {
    const pending = new Map<CacheDerivationBatch['namespace'], Map<string, HawdbEntry>>();
    let bytes = 0;
    return {
      record: (namespace, rows) => {
        if (!['annotation_cache', 'code_cache', 'config_cache', 'query_cache'].includes(namespace) || namespace === 'query_cache' && rows.some(row => !row.key.startsWith('writing:'))) throw new HawdbFailure('HawdbUnavailable', 'A worker cannot derive remote observations or historical results');
        const name = namespace as CacheDerivationBatch['namespace'];
        const entries = pending.get(name) ?? new Map<string, HawdbEntry>();
        let next = bytes;
        const changes = new Map(rows.map(row => [row.key, row]));
        for (const row of changes.values()) {
          const before = entries.get(row.key);
          next += Buffer.byteLength(row.key) + Buffer.byteLength(row.payload) - (before ? Buffer.byteLength(before.key) + Buffer.byteLength(before.payload) : 0);
        }
        if (next > 32 * 1024 * 1024) throw new HawdbFailure('HawdbLimit', 'One worker produced more than 32 MiB of cache derivations');
        bytes = next;
        for (const row of changes.values()) entries.set(row.key, Object.freeze({ ...row }));
        pending.set(name, entries);
      },
      batches: () => [...pending].map(([namespace, entries]) => ({ namespace, entries: [...entries.values()] })),
    };
  }
}
