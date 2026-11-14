// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Clock, Deferred, Effect, Semaphore, Schema } from 'effect';
import { ConcordError } from '../../model/index.ts';
import { PersistentCache, type PersistentCacheService } from './service.ts';
import { HawdbFailure, validateHawdbArtifact } from './hawdb-native.ts';
import { HawdbEntry } from './hawdb-types.ts';
import type { CacheDerivationBatch, RemoteFeedback } from '../../model/index.ts';
import { RuntimeEnvironment } from '../environment/index.ts';
import { DatabaseWorker } from './worker-client.ts';
import { DatabaseClear, DatabaseSnapshot, DatabaseStatus, type DatabaseOperation } from './worker-protocol.ts';
import { KnowledgeResult } from './knowledge-search-model.ts';
import { cacheDatabasePath } from './cache-file.ts';

/** The service owns one Worker; only that Worker owns the native database. */
export const makePersistentCacheOwner = Effect.fn('makePersistentCacheOwner')(function*(privateDir: string) {
  const backend = yield* PersistentCache, runtime = yield* RuntimeEnvironment;
  let database: DatabaseWorker | undefined, openError: HawdbFailure | undefined, fatal: HawdbFailure | undefined;
  const failed = yield* Deferred.make<HawdbFailure>();
  let validatedAt = -Infinity, validationError: HawdbFailure | undefined;
  const verify = Effect.gen(function*() {
    if (fatal) return yield* Effect.fail(fatal);
    const now = yield* Clock.currentTimeMillis;
    if (now - validatedAt >= 1000) {
      validatedAt = now;
      const outcome = yield* Effect.result(Effect.try({ try: () => validateHawdbArtifact(runtime), catch: cause => new HawdbFailure('HawdbUnavailable', `Native artifact validation failed: ${String(cause)}`) }));
      validationError = outcome._tag === 'Failure' ? outcome.failure : undefined;
    }
    if (validationError) return yield* Effect.fail(validationError);
  });
  const lifecycle = yield* Semaphore.make(1);
  const closeUnlocked = Effect.promise(async () => { const previous = database; database = undefined; await previous?.close(); });
  const close = Effect.uninterruptible(lifecycle.withPermit(closeUnlocked));
  const use = (operation: DatabaseOperation, background = false) => Effect.suspend(() => {
    let pending: Promise<unknown> | undefined;
    return Effect.tryPromise({ try: signal => {
      if (!database) throw openError ?? new HawdbFailure('HawdbUnavailable', 'Workspace database Worker is unavailable');
      const request = database.request(operation, { signal, background });
      pending = request;
      return request;
    }, catch: cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause)) }).pipe(Effect.ensuring(Effect.promise(async () => { await pending?.then(() => undefined, () => undefined); })));
  });
  const open = lifecycle.withPermit(Effect.gen(function*() {
    yield* verify;
    if (database && !openError) return;
    yield* closeUnlocked;
    database = new DatabaseWorker(error => { fatal = error; Deferred.doneUnsafe(failed, Effect.succeed(error)); });
    const result = yield* Effect.result(use({ op: 'open', privateDir, runtime }));
    openError = result._tag === 'Failure' ? result.failure : undefined;
    if (openError) return yield* Effect.fail(openError);
  }).pipe(Effect.onInterrupt(() => closeUnlocked)));
  yield* Effect.addFinalizer(() => close);
  const makeService = (background: boolean): PersistentCacheService => {
    const service: PersistentCacheService = {
      verifyArtifact: backend.verifyArtifact,
      attach: () => Effect.fail(new HawdbFailure('HawdbUnavailable', 'The persistent owner cannot execute repository operations')),
      read: (_directory, namespace, keys) => use({ op: 'read', namespace, ...(keys === undefined ? {} : { keys }) }, background).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HawdbEntry))), Effect.mapError(cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbIncompatible', String(cause)))),
      update: (_directory, namespace, key, update) => Effect.gen(function*() {
        for (let attempt = 0; attempt < 3; attempt++) {
          const prior = (yield* service.read(privateDir, namespace, [key]))[0]?.payload;
          const candidate = yield* Effect.try({ try: () => update(prior), catch: cause => cause instanceof ConcordError ? cause : new HawdbFailure('HawdbUnavailable', String(cause)) });
          if ((yield* use({ op: 'compare', namespace, key, expected: prior ?? null, payload: candidate }, background)) === true) return;
        }
        return yield* Effect.fail(new HawdbFailure('HawdbBusy', 'Cache observation changed during comparison'));
      }),
    };
    return service;
  };
  const snapshot = (background: boolean) => use({ op: 'snapshot' }, background).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DatabaseSnapshot)));
  const status = Effect.suspend(() => {
    if (database) return use({ op: 'status' }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DatabaseStatus)));
    const error = fatal ?? validationError ?? openError;
    return Effect.succeed({ status: 'unavailable', path: cacheDatabasePath(privateDir), physicalBytes: null, detail: error ? `${error.code}: ${error.message}` : 'HawdbUnavailable: Database Worker is not open' });
  });
  const clear = lifecycle.withPermit(Effect.gen(function*() {
    yield* verify;
    if (!database) {
      database = new DatabaseWorker(error => { fatal = error; Deferred.doneUnsafe(failed, Effect.succeed(error)); });
      const opened = yield* Effect.result(use({ op: 'open', privateDir, runtime }));
      if (opened._tag === 'Failure') {
        openError = opened.failure;
        // A status reply proves the Worker initialized its maintenance context.
        // A broken database can report unavailable without granting business access.
        yield* use({ op: 'status' }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DatabaseStatus)));
      }
    }
    return yield* use({ op: 'clear' }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DatabaseClear)));
  }).pipe(Effect.tap(() => Effect.sync(() => { openError = undefined; })), Effect.tapError(cause => Effect.sync(() => { openError = cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbUnavailable', String(cause)); }))));
  return { open, close, verify, service: makeService(false), backgroundService: makeService(true), failed: Deferred.await(failed),
    snapshot: snapshot(false), backgroundSnapshot: snapshot(true),
    mergeDerived: (batches: readonly CacheDerivationBatch[], background = false) => use({ op: 'derived', batches }, background).pipe(Effect.asVoid),
    status, clear,
    mergeFeedback: (connectionId: string, items: readonly RemoteFeedback[]) => use({ op: 'feedback', connectionId, items }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.String)))),
    search: (input: Extract<DatabaseOperation, { readonly op: 'search' }>) => use(input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(KnowledgeResult)), Effect.mapError(cause => cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbIncompatible', String(cause)))),
    discardSearch: (kind: 'memory' | 'issue', memory: boolean) => use({ op: 'discard-search', kind, memory }).pipe(Effect.asVoid),
  };
});
