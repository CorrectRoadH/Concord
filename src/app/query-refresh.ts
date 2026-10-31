import { join } from "node:path";
import { Effect, Result } from "effect";
import { acquireFileLease, CoordinationError, recoverFileLease, releaseFileLease } from "../base/publication/index.js";
import { Query, queryContext, queryRequestSatisfied, readQuery, type QueryUpdate } from "./query-cache.js";
import { makeOwnedProcessService, hasConfirmedOwnedGroupCleanup, type OwnedProcessResult } from "../base/process/index.js";
import { decodeQueryScanMessage, type QueryScanMessage } from "../model/index.js";
import { failure } from "../model/index.js";
import { workerEntryArgv } from "../base/installation/index.js";
import { requestNewIdentity } from "./query-refresh-store.js";
import { persist } from "./query-refresh-store.js";


// @concord-code
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#刷新上限
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


// @concord-code
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export function classifyQueryRefresh(before: string, after: string, result: OwnedProcessResult, scannedAt: number, elapsedMs: number, limitMs: number) {
  return before === after ? classifyQueryScan(result, scannedAt, elapsedMs, limitMs) : { kind: 'identity-changed' as const };
}

// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#刷新上限
export const refreshQuery = Effect.fn('refreshQuery')(function*(input: string | undefined, query: Query, requestedAt: number, limitMs = 120_000) {
  const started = Date.now(), deadline = started + limitMs;
  const context = yield* queryContext(input, query);
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
  const before = yield* queryContext(context.root, query);
  // Queued old-identity owners abandon their request before starting another scan.
  if (before.key !== context.key) return;
  const previous = yield* Effect.sync(() => readQuery(context));
  if (queryRequestSatisfied(previous, requestedAt)) return;
  const scannedAt = Date.now();
  const service = makeOwnedProcessService();
  const outcome = yield* Effect.result(service.run([process.execPath, ...workerEntryArgv('query-scan-worker'), context.root, JSON.stringify(query)],
    { cwd: context.root, timeoutMs: Math.max(1, deadline - Date.now()), outputLimitBytes: 4 * 1024 * 1024 }));
  const after = yield* queryContext(context.root, query);
  const update = Result.isSuccess(outcome) ? classifyQueryRefresh(context.key, after.key, outcome.success, scannedAt, Date.now() - started, limitMs)
    : after.key !== context.key ? { kind: 'identity-changed' as const } : { kind: 'failure' as const, error: { failedAt: new Date().toISOString(), scannedAt, code: 'QueryRefreshFailed', message: outcome.failure.message.slice(0, 4096) } };
  if (update.kind === 'identity-changed') { yield* requestNewIdentity(after); return; }
  yield* persist(context, update);
});
// @concord-end
