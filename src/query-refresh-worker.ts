// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Result, Schema } from 'effect';
import { HawdbFailure } from './hawdb-native.js';
import { acquireFileLease, CoordinationError, recoverFileLease, releaseFileLease } from './file-lease.js';
import { Query, queryContext, queryRequestSatisfied, readQuery, storeQuery, type QueryContext, type QueryUpdate } from './query-cache.js';
import { makeOwnedProcessService, hasConfirmedOwnedGroupCleanup, type OwnedProcessResult } from './owned-process.js';
import { decodeQueryScanMessage, type QueryScanMessage } from './query-scan-protocol.js';
import { ConcordError, failure } from './shared.js';

export function classifyQueryScan(result: OwnedProcessResult, scannedAt: number, elapsedMs: number, limitMs: number): QueryUpdate {
  const failed = (code: string, message: string, timing = false): QueryUpdate => ({ kind: 'failure', error: {
    failedAt: new Date().toISOString(), scannedAt, code, message: message.slice(0, 4096), ...(timing ? { elapsedMs, limitMs } : {}) } });
  if (result.timedOut) return failed('QueryRefreshTimedOut', `Refresh scan exceeded ${limitMs}ms`, true);
  if (result.outputLimitExceeded) return failed('QueryRefreshOutputLimit', 'Refresh scan exceeded 4 MiB');
  let message: QueryScanMessage;
  try { message = decodeQueryScanMessage(JSON.parse(result.stdout)); }
  catch { return failed('QueryRefreshFailed', result.stderr || result.error || 'Scan exited without a valid message'); }
  if (result.exitCode !== 0 || result.signal !== null || result.error !== undefined || result.cancelled) return failed('QueryRefreshFailed', result.stderr || result.error || 'Scan process exited abnormally');
  if (!hasConfirmedOwnedGroupCleanup(result)) return failed('QueryRefreshCleanupUnconfirmed', 'Scan process group cleanup could not be confirmed');
  if (message.ok) return { kind: 'candidate', message };
  if (message.code === 'SourceChanged' || message.code === 'DocumentNotFound' || message.code === 'PreimageChanged' && message.details === 'source-observation') {
    return { kind: 'drift', scannedAt: message.scannedAt, at: new Date().toISOString(), changedPaths: ['.'] };
  }
  return { kind: 'failure', error: { failedAt: new Date().toISOString(), scannedAt: message.scannedAt, code: message.code, message: message.message.slice(0, 4096) } };
}

export function classifyQueryRefresh(before: string, after: string, result: OwnedProcessResult, scannedAt: number, elapsedMs: number, limitMs: number) {
  return before === after ? classifyQueryScan(result, scannedAt, elapsedMs, limitMs) : { kind: 'identity-changed' as const };
}

const requestNewIdentity = Effect.fn('requestNewQueryIdentity')(function*(context: QueryContext) {
  yield* Effect.tryPromise({ try: () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), context.root, JSON.stringify(context.query), String(Date.now())], { detached: true, stdio: 'ignore', cwd: context.root });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  }), catch: failure });
});
const persist = Effect.fn('persistQuery')(function*(context: QueryContext, update: QueryUpdate) {
  const deadline = Date.now() + 3000;
  while (true) {
    const current = yield* Effect.try({ try: () => queryContext(context.root, context.query), catch: failure });
    if (current.key !== context.key) { yield* requestNewIdentity(current); return; }
    const result = yield* Effect.result(Effect.try({ try: () => storeQuery(context, update), catch: cause => cause }));
    if (Result.isSuccess(result)) return;
    if (!(result.failure instanceof HawdbFailure) || !['HawdbBusy', 'UnsafePath'].includes(result.failure.code) || Date.now() >= deadline) return yield* Effect.fail(result.failure);
    yield* Effect.sleep('25 millis');
  }
});
export const refreshQuery = Effect.fn('refreshQuery')(function*(input: string | undefined, query: Query, requestedAt: number, limitMs = 120_000) {
  const started = Date.now(), deadline = started + limitMs;
  const context = yield* Effect.try({ try: () => queryContext(input, query), catch: failure });
  const directory = join(context.privateDir, 'query-refresh');
  const acquire = Effect.try(() => {
    try { return acquireFileLease(context.root, directory, context.key, 'exclusive', 'query-refresh'); }
    catch (cause) {
      if (!(cause instanceof CoordinationError) || cause.reason !== 'occupied') throw cause;
      try { recoverFileLease(context.root, join(directory, context.key), 'query-refresh'); } catch { return undefined; }
      try { return acquireFileLease(context.root, directory, context.key, 'exclusive', 'query-refresh'); }
      catch (retryCause) { if (retryCause instanceof CoordinationError && retryCause.reason === 'occupied') return undefined; throw retryCause; }
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
  const before = yield* Effect.try({ try: () => queryContext(context.root, query), catch: failure });
  // Queued old-identity owners abandon their request before starting another scan.
  if (before.key !== context.key) return;
  const previous = yield* Effect.sync(() => readQuery(context));
  if (queryRequestSatisfied(previous, requestedAt)) return;
  const scannedAt = Date.now();
  const service = makeOwnedProcessService();
  const outcome = yield* Effect.result(service.run([process.execPath, fileURLToPath(new URL('./query-scan-worker.js', import.meta.url)), context.root, JSON.stringify(query)],
    { cwd: context.root, timeoutMs: Math.max(1, deadline - Date.now()), outputLimitBytes: 4 * 1024 * 1024 }));
  const after = yield* Effect.try({ try: () => queryContext(context.root, query), catch: failure });
  const update = Result.isSuccess(outcome) ? classifyQueryRefresh(context.key, after.key, outcome.success, scannedAt, Date.now() - started, limitMs)
    : after.key !== context.key ? { kind: 'identity-changed' as const } : { kind: 'failure' as const, error: { failedAt: new Date().toISOString(), scannedAt, code: 'QueryRefreshFailed', message: outcome.failure.message.slice(0, 4096) } };
  if (update.kind === 'identity-changed') { yield* requestNewIdentity(after); return; }
  yield* persist(context, update);
});

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  NodeRuntime.runMain(Effect.gen(function*() {
    const query = yield* Schema.decodeUnknownEffect(Query)(JSON.parse(process.argv[3] ?? 'null'));
    const positive = Schema.Number.check(Schema.isGreaterThan(0));
    const requestedAt = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[4]));
    const limitMs = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[5] ?? 120_000));
    yield* refreshQuery(process.argv[2], query, requestedAt, limitMs);
  }).pipe(Effect.scoped));
}
