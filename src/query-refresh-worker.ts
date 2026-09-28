// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Result, Schema } from 'effect';
import { HawdbFailure } from './hawdb-native.js';
import { acquireFileLease, CoordinationError, recoverFileLease, releaseFileLease } from './file-lease.js';
import { Query, queryContext, readQuery, storeQuery } from './query-cache.js';
import { makeOwnedProcessService, hasSuccessfulOwnedProcessResult } from './owned-process.js';
import { ConcordError, failure } from './shared.js';
import { readPublicationRevisionSync } from './coordination.js';

const persist = Effect.fn('persistQuery')(function*(context: ReturnType<typeof queryContext>, value: unknown, error?: ConcordError, scannedAt = Date.now()) {
  const deadline = Date.now() + 3000;
  while (true) {
    const result = yield* Effect.result(Effect.try({ try: () => storeQuery(context, value, error, scannedAt), catch: cause => cause }));
    if (Result.isSuccess(result)) return;
    if (!(result.failure instanceof HawdbFailure) || !['HawdbBusy', 'UnsafePath'].includes(result.failure.code) || Date.now() >= deadline) return yield* Effect.fail(result.failure);
    yield* Effect.sleep('25 millis');
  }
});

const main = Effect.gen(function*() {
  const query = yield* Schema.decodeUnknownEffect(Query)(JSON.parse(process.argv[3] ?? 'null'));
  const requestedAt = yield* Schema.decodeUnknownEffect(Schema.Int.check(Schema.isGreaterThan(0)))(Number(process.argv[4]));
  const context = yield* Effect.try({ try: () => queryContext(process.argv[2], query), catch: failure });
  const directory = join(context.privateDir, 'query-refresh');
  const deadline = Date.now() + 120_000;
  const acquire = Effect.try(() => {
    try { return acquireFileLease(context.root, directory, context.key, 'exclusive', 'query-refresh'); }
    catch (cause) {
      if (!(cause instanceof CoordinationError) || cause.reason !== 'occupied') throw cause;
      try { recoverFileLease(context.root, join(directory, context.key), 'query-refresh'); }
      catch { return undefined; }
      try { return acquireFileLease(context.root, directory, context.key, 'exclusive', 'query-refresh'); }
      catch (retryCause) {
        if (retryCause instanceof CoordinationError && retryCause.reason === 'occupied') return undefined;
        throw retryCause;
      }
    }
  });
  const lease = yield* Effect.acquireRelease(Effect.gen(function*() {
    while (Date.now() < deadline) {
      const lease = yield* acquire;
      if (lease) return lease;
      yield* Effect.sleep('100 millis');
    }
    return undefined;
  }), lease => Effect.sync(() => { if (lease) releaseFileLease(lease, 'query-refresh'); }));
  if (!lease) return;
  // Only a scan started after this request can fulfill a queued refresh.
  const previous = yield* Effect.sync(() => readQuery(context));
  if ((previous.record?.scannedAt ?? 0) >= requestedAt || (previous.error?.scannedAt ?? 0) >= requestedAt) return;
  const scannedAt = Date.now();
  const processService = makeOwnedProcessService();
  // A source scan must not monopolize the engine serving historical projections.
  // Dry-run disables persistent parser cache writes/handles for these read queries.
  const outcome = yield* Effect.result(Effect.gen(function*() {
    const revision = yield* Effect.try({ try: () => readPublicationRevisionSync(context.root), catch: failure });
    const result = yield* processService.run([process.execPath, fileURLToPath(new URL('./entry.js', import.meta.url)), '--root', context.root, '--json', '--fresh', '--dry-run', ...query], { cwd: context.root, timeoutMs: Math.max(1, deadline - Date.now()), outputLimitBytes: 4 * 1024 * 1024 });
    if (!hasSuccessfulOwnedProcessResult(result)) {
      return yield* Effect.fail(new ConcordError('QueryRefreshFailed', (result.stderr || result.stdout || result.error || 'Diagnostic scan failed or timed out').slice(0, 4096)));
    }
    const value = yield* Effect.try({ try: () => {
      if (queryContext(context.root, query).key !== context.key || readPublicationRevisionSync(context.root) !== revision) throw new ConcordError('SourceChanged', 'Sources or installation changed during refresh');
      return JSON.parse(result.stdout) as unknown;
    }, catch: failure });
    yield* persist(context, value, undefined, scannedAt);
  }));
  if (Result.isFailure(outcome)) {
    const cause = outcome.failure;
    const error = cause instanceof ConcordError ? cause : new ConcordError(cause instanceof HawdbFailure ? cause.code : 'QueryRefreshFailed', cause instanceof Error ? cause.message : String(cause));
    yield* persist(context, null, error, scannedAt);
  }
}).pipe(Effect.scoped);

NodeRuntime.runMain(main);
