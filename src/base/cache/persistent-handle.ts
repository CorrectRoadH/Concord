// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect } from 'effect';
import { assertCacheDatabaseSafe, cacheDatabasePath } from './cache-file.ts';
import { HawdbFailure, openHawdb } from './hawdb-native.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';

/** Only the base owner borrows this handle, within its own closeable scope. */
export const openPersistentHandle = Effect.fn('Cache.openPersistentHandle')(function*(privateDir: string, runtime: RuntimeEnvironmentSnapshot) {
  return yield* Effect.acquireRelease(Effect.try({
    try: () => {
      const path = cacheDatabasePath(privateDir);
      assertCacheDatabaseSafe(path);
      try { return openHawdb(path, { readOnly: false, create: true }, runtime); }
      catch (cause) { if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy') return undefined; throw cause; }
    }, catch: cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause)),
  }), database => Effect.sync(() => database?.close()));
});
