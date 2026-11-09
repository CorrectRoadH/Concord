// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect } from 'effect';
import { assertCacheDatabaseSafe, cacheDatabasePath, inspectCacheClear, deleteInspectedCache } from './cache-file.ts';
import { HawdbFailure, openHawdb, openHawdbAsync, acquireHawdbClearGuard } from './hawdb-native.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';

/** Writable owners discard only rebuildable formats, under the native clear lock.
 * Readonly admission never mutates a directory; contention stays HawdbBusy so
 * each caller can choose its existing memory fallback without losing ownership. */
export function openCurrentPersistentCache(privateDir: string, writable: boolean, runtime: RuntimeEnvironmentSnapshot) {
  const path = cacheDatabasePath(privateDir);
  assertCacheDatabaseSafe(path);
  try { return openHawdb(path, { readOnly: !writable, create: writable }, runtime); }
  catch (cause) {
    if (!writable || !(cause instanceof HawdbFailure) || cause.code !== 'HawdbIncompatible') throw cause;
    rebuildIncompatibleCache(privateDir, path, runtime);
    return openHawdb(path, { readOnly: false, create: true }, runtime);
  }
}

function rebuildIncompatibleCache(privateDir: string, path: string, runtime: RuntimeEnvironmentSnapshot): void {
  const guard = acquireHawdbClearGuard(path, runtime);
  try { deleteInspectedCache(inspectCacheClear(privateDir), () => guard.verify()); }
  finally { guard.close(); }
}

/** Only the base owner borrows this handle, within its own closeable scope. */
export const openPersistentHandle = Effect.fn('Cache.openPersistentHandle')(function*(privateDir: string, runtime: RuntimeEnvironmentSnapshot) {
  return yield* Effect.acquireRelease(Effect.tryPromise({
    try: async () => {
      const path = cacheDatabasePath(privateDir);
      assertCacheDatabaseSafe(path);
      try {
        try { return await openHawdbAsync(path, { readOnly: false, create: true }, runtime); }
        catch (cause) {
          if (!(cause instanceof HawdbFailure) || cause.code !== 'HawdbIncompatible') throw cause;
          rebuildIncompatibleCache(privateDir, path, runtime);
          return await openHawdbAsync(path, { readOnly: false, create: true }, runtime);
        }
      } catch (cause) {
        if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy') return undefined;
        throw cause;
      }
    }, catch: cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause)),
  }), database => database ? Effect.promise(() => database.closeAsync()) : Effect.void);
});
