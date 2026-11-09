// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Clock, Effect, Exit, Scope, Semaphore } from 'effect';
import { ConcordError } from '../../model/index.ts';
import { PersistentCache, type PersistentCacheService, type ReadonlyCacheSnapshot } from './service.ts';
import { HawdbFailure, validateHawdbArtifact, type HawdbDatabase, type HawdbNamespace, type HawdbEntry } from './hawdb-native.ts';
import { CacheDerivationBatch } from '../../model/index.ts';
import { Schema } from 'effect';
import { writeCachePayloads } from './cache-query.ts';
import { mergeFeedbackRows } from './feedback-cache.ts';
import type { RemoteFeedback } from '../../model/index.ts';
import { RuntimeEnvironment } from '../environment/index.ts';
import { openPersistentHandle } from './persistent-handle.ts';
import { inspectCacheStatus } from './cache-status.ts';

/** One scoped owner, with an explicit close/reopen boundary for maintenance. */
export const makePersistentCacheOwner = Effect.fn('makePersistentCacheOwner')(function*(privateDir: string) {
  const backend = yield* PersistentCache;
  const runtime = yield* RuntimeEnvironment;
  let scope: Scope.Closeable | undefined;
  let database: HawdbDatabase | undefined;
  let openError: HawdbFailure | undefined;
  const snapshots = new Map<HawdbNamespace, readonly HawdbEntry[]>();
  let validatedAt = -Infinity, validationError: HawdbFailure | undefined;
  const verify = Effect.gen(function*() {
    const now = yield* Clock.currentTimeMillis;
    if (now - validatedAt >= 1000) {
      validatedAt = now;
      const outcome = yield* Effect.result(Effect.try({ try: () => validateHawdbArtifact(runtime), catch: cause => new HawdbFailure('HawdbUnavailable', `Native artifact validation failed: ${cause instanceof Error ? cause.message : String(cause)}`) }));
      validationError = outcome._tag === 'Failure' ? outcome.failure : undefined;
    }
    if (validationError) return yield* Effect.fail(validationError);
  });
  const lifecycle = yield* Semaphore.make(1);
  const closeUnlocked = Effect.suspend(() => {
    snapshots.clear();
    const prior = scope; scope = undefined; database = undefined;
    return prior ? Scope.close(prior, Exit.void) : Effect.void;
  });
  const close = Effect.uninterruptible(lifecycle.withPermit(closeUnlocked));
  const open = lifecycle.withPermit(Effect.uninterruptibleMask(restore => Effect.gen(function*() {
    yield* closeUnlocked;
    openError = undefined;
    yield* verify;
    const nextScope = yield* Scope.make();
    const acquired = yield* Effect.exit(restore(openPersistentHandle(privateDir, runtime).pipe(
      Effect.provideService(Scope.Scope, nextScope),
      Effect.flatMap(value => value ? Effect.succeed(value) : Effect.fail(new HawdbFailure('HawdbBusy', 'Persistent cache is owned by another command'))),
    )));
    if (Exit.isFailure(acquired)) {
      yield* Scope.close(nextScope, acquired);
      return yield* Effect.failCause(acquired.cause);
    }
    scope = nextScope;
    database = acquired.value;
  }))).pipe(Effect.tapError(error => Effect.sync(() => { openError = error; })));
  yield* Effect.addFinalizer(() => close);
  const use = <A>(run: (database: HawdbDatabase) => A) => verify.pipe(Effect.andThen(Effect.try({ try: () => {
    if (!database) throw openError ?? new HawdbFailure('HawdbUnavailable', 'Workspace persistent cache is unavailable');
    return run(database);
  }, catch: cause => cause instanceof HawdbFailure || cause instanceof ConcordError ? cause : new HawdbFailure('HawdbUnavailable', String(cause)) })));
  const service: PersistentCacheService = {
    verifyArtifact: backend.verifyArtifact,
    reclaim: () => use(db => db.reclaim()).pipe(Effect.mapError(cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', cause.message))),
    attach: () => Effect.fail(new HawdbFailure('HawdbUnavailable', 'The persistent owner cannot execute repository operations')),
    read: (_directory, namespace, keys) => use(db => keys === undefined ? db.scan(namespace) : db.get(namespace, keys)).pipe(Effect.mapError(cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', cause.message))),
    update: (_directory, namespace, key, update) => use(db => { db.put(namespace, [{ key, payload: update(db.get(namespace, [key])[0]?.payload) }]); snapshots.delete(namespace); }),
  };
  const snapshot = use(db => Object.fromEntries((['annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache'] as const).map(namespace => {
    let rows = snapshots.get(namespace);
    if (!rows) { rows = Object.freeze(db.scan(namespace).map(row => Object.freeze({ ...row }))); snapshots.set(namespace, rows); }
    return [namespace, rows];
  })) as ReadonlyCacheSnapshot);
  const mergeDerived = (input: readonly CacheDerivationBatch[]) => use(db => {
    const batches = Schema.decodeUnknownSync(Schema.Array(CacheDerivationBatch), { onExcessProperty: 'error' })(input);
    for (const batch of batches) {
      if (batch.namespace === 'query_cache' && batch.entries.some(row => !row.key.startsWith('writing:'))) throw new HawdbFailure('HawdbUnavailable', 'A computation cannot replace historical query observations');
      try { writeCachePayloads(db, batch.namespace, batch.entries); }
      finally { snapshots.delete(batch.namespace); }
    }
  });
  const status = Effect.sync(() => inspectCacheStatus(privateDir, true, () => {
    if (!database) throw openError ?? new HawdbFailure('HawdbUnavailable', 'Workspace persistent cache is unavailable');
    return database;
  }, undefined, runtime));
  return { open, close, verify, service, snapshot, mergeDerived, status,
    mergeFeedback: (connectionId: string, items: readonly RemoteFeedback[]) => use(db => { const warnings = mergeFeedbackRows(db, connectionId, items); snapshots.delete('feedback_cache'); return warnings; }),
  };
});
