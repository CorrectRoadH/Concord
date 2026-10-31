// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect, Exit, Scope } from 'effect';
import { ConcordError } from '../../model/index.js';
import { PersistentCache, type PersistentCacheService, type ReadonlyCacheSnapshot } from './service.js';
import { HawdbFailure, type HawdbDatabase } from './hawdb-native.js';
import { mergeFeedbackRows } from './feedback-cache.js';
import type { RemoteFeedback } from '../../model/index.js';

/** One scoped owner, with an explicit close/reopen boundary for maintenance. */
export const makePersistentCacheOwner = Effect.fn('makePersistentCacheOwner')(function*(privateDir: string) {
  const backend = yield* PersistentCache;
  let scope: Scope.Closeable | undefined;
  let database: HawdbDatabase | undefined;
  const close = Effect.suspend(() => {
    const prior = scope; scope = undefined; database = undefined;
    return prior ? Scope.close(prior, Exit.void) : Effect.void;
  });
  const open = Effect.gen(function*() {
    yield* close;
    scope = yield* Scope.make();
    database = yield* backend.open(privateDir).pipe(Effect.provideService(Scope.Scope, scope));
    if (!database) return yield* Effect.fail(new HawdbFailure('HawdbBusy', 'Persistent cache is owned by another command'));
  });
  yield* Effect.addFinalizer(() => close);
  const use = <A>(run: (database: HawdbDatabase) => A) => Effect.try({ try: () => {
    if (!database) throw new HawdbFailure('HawdbUnavailable', 'Workspace persistent cache is unavailable');
    return run(database);
  }, catch: cause => cause instanceof HawdbFailure || cause instanceof ConcordError ? cause : new HawdbFailure('HawdbUnavailable', String(cause)) });
  const service: PersistentCacheService = {
    attach: () => Effect.fail(new HawdbFailure('HawdbUnavailable', 'The persistent owner cannot execute repository operations')),
    open: () => Effect.fail(new HawdbFailure('HawdbUnavailable', 'The owner does not transfer database handles')),
    read: (_directory, namespace, keys) => use(db => keys === undefined ? db.scan(namespace) : db.get(namespace, keys)).pipe(Effect.mapError(cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', cause.message))),
    update: (_directory, namespace, key, update) => use(db => db.put(namespace, [{ key, payload: update(db.get(namespace, [key])[0]?.payload) }])),
  };
  const snapshot = use(db => Object.fromEntries(['feedback_cache', 'query_cache', 'workspace_projection'].map(namespace => [namespace, db.scan(namespace as 'feedback_cache' | 'query_cache' | 'workspace_projection')])) as ReadonlyCacheSnapshot);
  return { open, close, service, snapshot, mergeFeedback: (connectionId: string, items: readonly RemoteFeedback[]) => use(db => mergeFeedbackRows(db, connectionId, items)) };
});
