// @concord-file
// @concord-implements docs/engineering/code/architecture.md#capability-boundaries
import { Context, Effect } from 'effect';
import { ConcordError } from '../../model/index.ts';
import type { WorkspaceMetadata } from '../workspace/context.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { assertLeasePath } from '../publication/file-lease.ts';
import { openCurrentPersistentCache } from './persistent-handle.ts';
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from './cache-file.ts';
import { HawdbFailure, type HawdbDatabase, type HawdbEntry, type HawdbNamespace, type HawdbReclamation } from './hawdb-native.ts';

/** Private to base: an operation owns handles, never a workspace metadata value. */
export class OperationCache extends Context.Service<OperationCache, {
  readonly privateDir: string;
  readonly read: (namespace: HawdbNamespace, keys?: readonly string[]) => readonly HawdbEntry[];
  readonly update: (namespace: HawdbNamespace, key: string, update: (prior: string | undefined) => string) => void;
  readonly reclaim: () => HawdbReclamation;
  readonly enterPublication: () => void;
  readonly leavePublication: () => void;
  readonly publishing: () => boolean;
}>()('concord/base/cache/OperationCache') {}

export const withOperationCache = <A, E, R>(workspace: WorkspaceMetadata, runtime: RuntimeEnvironmentSnapshot, operation: Effect.Effect<A, E, R>) => Effect.gen(function*() {
  const inherited = yield* Effect.serviceOption(OperationCache);
  const parent = inherited._tag === 'Some' ? inherited.value : undefined;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => {
      let database: HawdbDatabase | undefined;
      let writable = false, closed = false, publications = 0;
      const close = () => {
        const prior = database;
        database = undefined; writable = false;
        prior?.close();
      };
      const open = (write: boolean) => {
        if (closed) throw new HawdbFailure('HawdbClosed', 'The source snapshot cache scope is closed');
        if (publications > 0 || parent?.publishing()) throw new HawdbFailure('HawdbUnavailable', 'Persistent cache cannot open during publication');
        if (workspace.cache === 'off') {
          if (write) throw new HawdbFailure('HawdbUnavailable', 'Persistent cache access is disabled');
          return undefined;
        }
        if (database && write && !writable) close();
        if (database) return database;
        const path = cacheDatabasePath(workspace.privateDir);
        assertLeasePath(path);
        const existing = assertCacheDatabaseSafe(path);
        if (!write && (!existing || cacheRootOwnerOnly(path))) return undefined;
        database = openCurrentPersistentCache(workspace.privateDir, write, runtime);
        writable = write;
        return database;
      };
      return {
        close: () => { closed = true; close(); },
        service: OperationCache.of({
          privateDir: workspace.privateDir,
          read: (namespace, keys) => {
            let handle: HawdbDatabase | undefined;
            try { handle = open(false); }
            catch (cause) {
              if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy' && ['annotation_cache', 'code_cache', 'config_cache'].includes(namespace)) return [];
              throw cause;
            }
            return handle === undefined ? [] : keys === undefined ? handle.scan(namespace) : handle.get(namespace, keys);
          },
          update: (namespace, key, update) => {
            let handle: HawdbDatabase;
            try { handle = open(true)!; }
            catch (cause) {
              if (cause instanceof HawdbFailure && cause.code === 'HawdbBusy' && ['annotation_cache', 'code_cache', 'config_cache'].includes(namespace)) return;
              throw cause;
            }
            handle.put(namespace, [{ key, payload: update(handle.get(namespace, [key])[0]?.payload) }]);
          },
          reclaim: () => open(true)!.reclaim(),
          enterPublication: () => {
            if (closed) throw new ConcordError('OperationFailed', 'Cannot publish from a closed source snapshot');
            close();
            parent?.enterPublication();
            publications++;
          },
          leavePublication: () => { publications--; parent?.leavePublication(); },
          publishing: () => publications > 0 || (parent?.publishing() ?? false),
        }),
      };
    }),
    owner => operation.pipe(Effect.provideService(OperationCache, owner.service)),
    owner => Effect.sync(owner.close),
  );
});
