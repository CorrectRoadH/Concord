import { RuntimeEnvironment } from '../base/environment/index.ts';
import { launchDetachedWorker } from '../base/process/index.ts';
import { Context, Effect, Option, Result, Schema } from "effect";
import { Workspace } from "../base/workspace/index.ts";
import { genericPrivateDirectorySync } from "../base/publication/index.ts";
import { assertLeasePath } from "../base/publication/index.ts";
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from "../base/cache/index.ts";
import { CacheSnapshot, HawdbFailure, PersistentCache } from "../base/cache/index.ts";
import { hydrateQueryValue } from "./query-values.ts";
import { TraceGapsValue, TraceShowValue, ReviewRenderValue, queryValueSchema } from "../model/index.ts";
import type { QueryScanMessage } from "../model/index.ts";
import { ConcordError, digest, failure } from "../model/index.ts";
import { queryInstallationIdentity, workerEntryArgv } from "../base/installation/index.ts";

// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export const Query = Schema.Union([
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('gaps')]),
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('show'), Schema.String]),
  Schema.Tuple([Schema.Literal('review')]),
  Schema.Tuple([Schema.Literal('review'), Schema.String]),
]);
export type Query = typeof Query.Type;
export class QueryRefreshRequest extends Context.Service<QueryRefreshRequest, {
  readonly request: (context: QueryContext) => Effect.Effect<void, ConcordError>;
}>()('concord/app/QueryRefreshRequest') {}
const Instant = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value))));
export const QueryRecord = Schema.Struct({
  builtAt: Instant, scannedAt: Schema.Number, builtFrom: Instant, builtUntil: Instant,
  consistent: Schema.Boolean, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String), unknownRelations: Schema.Boolean,
  unknown: Schema.Array(Schema.Literal('code')), value: Schema.Union([TraceGapsValue, TraceShowValue, ReviewRenderValue]),
}).check(Schema.makeFilter(value => value.consistent === (value.changedPaths.length === 0)
  && (!value.complete || value.consistent) && value.unknownRelations === (!value.complete || value.unknown.length > 0)
  && Date.parse(value.builtFrom) === value.scannedAt && Date.parse(value.builtUntil) >= value.scannedAt));
const Attempt = Schema.Struct({ scannedAt: Schema.Number, at: Instant, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String) });
export const RefreshFailure = Schema.Struct({ failedAt: Instant, scannedAt: Schema.Number, code: Schema.String, message: Schema.String.check(Schema.isMaxLength(4096)), elapsedMs: Schema.optional(Schema.Number), limitMs: Schema.optional(Schema.Number) });
export const QueryCacheEnvelope = Schema.Struct({
  format: Schema.Literal('concord.query-cache/v3'), key: Schema.String,
  record: Schema.optional(QueryRecord), lastAttempt: Schema.optional(Attempt), error: Schema.optional(RefreshFailure),
});
export type QueryCacheEnvelope = typeof QueryCacheEnvelope.Type;
// @concord-end
export type QueryUpdate = { readonly kind: 'candidate'; readonly message: Extract<QueryScanMessage, { ok: true }> }
  | { readonly kind: 'drift'; readonly scannedAt: number; readonly at: string; readonly changedPaths: readonly string[] }
  | { readonly kind: 'failure'; readonly error: typeof RefreshFailure.Type };
const decodeEnvelope = Schema.decodeUnknownSync(QueryCacheEnvelope, { onExcessProperty: 'error' });
/** One atomic envelope owns the result, most recent structural attempt, and failure. */
// @concord-code
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export function replaceQueryEnvelope(key: string, prior: QueryCacheEnvelope | undefined, update: QueryUpdate, publishedAt = new Date().toISOString()): QueryCacheEnvelope {
  const previous = prior?.key === key ? prior : undefined;
  if (update.kind === 'failure') return decodeEnvelope({ format: 'concord.query-cache/v3', key,
    ...(previous?.record ? { record: previous.record } : {}), ...(previous?.lastAttempt ? { lastAttempt: previous.lastAttempt } : {}), error: update.error });
  if (update.kind === 'drift') return decodeEnvelope({ format: 'concord.query-cache/v3', key,
    ...(previous?.record ? { record: previous.record } : {}),
    lastAttempt: { scannedAt: update.scannedAt, at: update.at, complete: false, changedPaths: [...new Set(update.changedPaths.length ? update.changedPaths : ['.'])].sort() } });
  const message = update.message;
  const changedPaths = [...new Set([...message.drift.files, ...message.drift.directories, ...(message.drift.publicationChanged ? ['.'] : [])])].sort();
  const consistent = changedPaths.length === 0, complete = consistent && message.complete;
  const candidate = { scannedAt: message.scannedAt, builtAt: publishedAt, builtFrom: new Date(message.scannedAt).toISOString(), builtUntil: new Date(message.finishedAt).toISOString(),
    consistent, complete, changedPaths, unknownRelations: !complete || message.unknown.length > 0, unknown: message.unknown, value: message.value };
  return decodeEnvelope({ format: 'concord.query-cache/v3', key,
    record: !consistent && previous?.record?.consistent ? previous.record : candidate,
    lastAttempt: { scannedAt: message.scannedAt, at: candidate.builtUntil, complete, changedPaths } });
}
// @concord-code
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export function queryRequestSatisfied(prior: Pick<QueryCacheEnvelope, 'record' | 'lastAttempt' | 'error'>, requestedAt: number): boolean {
  return Math.max(prior.record?.scannedAt ?? 0, prior.lastAttempt?.scannedAt ?? 0, prior.error?.scannedAt ?? 0) >= requestedAt;
}
export interface QueryContext { readonly root: string; readonly privateDir: string; readonly key: string; readonly query: Query }
// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export const queryContext = Effect.fn('queryContext')(function*(input: string | undefined, query: Query) {
  const workspace = yield* Workspace;
  const runtime = yield* RuntimeEnvironment;
  const { root, privateDir, config } = yield* workspace.identify(input);
  const installation = yield* Effect.try({ try: () => queryInstallationIdentity(runtime), catch: failure });
  const key = digest(JSON.stringify([root, privateDir, query, config, installation]));
  return { root, privateDir, key, query } satisfies QueryContext;
});
function decodeForQuery(context: QueryContext, payload: string): QueryCacheEnvelope | undefined {
  const header = Schema.decodeUnknownSync(Schema.Struct({ format: Schema.String }), { onExcessProperty: 'ignore' })(JSON.parse(payload));
  if (['concord.query-cache/v1', 'concord.query-cache/v2'].includes(header.format)) return undefined;
  if (header.format !== 'concord.query-cache/v3') throw new ConcordError('QueryCacheInvalid', 'Unrecognized query cache format');
  const envelope = decodeEnvelope(JSON.parse(payload));
  if (envelope.key !== context.key) throw new ConcordError('QueryCacheInvalid', 'Query cache identity mismatch');
  if (envelope.record) Schema.decodeUnknownSync(queryValueSchema(context.query), { onExcessProperty: 'error' })(envelope.record.value);
  return envelope;
}
export const readQuery = Effect.fn('readQuery')(function*(context: QueryContext): Effect.fn.Return<{ record?: typeof QueryRecord.Type; lastAttempt?: typeof Attempt.Type; error?: typeof RefreshFailure.Type; unavailable?: string; unavailableCode?: string }, never> {
  const cache = yield* Effect.serviceOption(PersistentCache);
  const snapshot = yield* Effect.serviceOption(CacheSnapshot);
  const rows = Option.isSome(cache) ? cache.value.read(context.privateDir, 'query_cache', [context.key]) : Option.isSome(snapshot) ? snapshot.value.get('query_cache', [context.key]) : Effect.fail(new HawdbFailure('HawdbUnavailable', 'No diagnostic snapshot is available'));
  return yield* rows.pipe(
    Effect.flatMap(rows => Effect.try({ try: () => {
      const payload = rows.find(row => row.key === context.key)?.payload;
      const envelope = payload === undefined ? undefined : decodeForQuery(context, payload);
      return { record: envelope?.record, lastAttempt: envelope?.lastAttempt, error: envelope?.error };
    }, catch: cause => cause })),
    Effect.catch(cause => Effect.succeed({ unavailable: cause instanceof Error ? cause.message : String(cause), unavailableCode: cause instanceof HawdbFailure ? cause.code : 'QueryCacheInvalid' })),
  );
});
export const storeQuery = Effect.fn('storeQuery')(function*(context: QueryContext, update: QueryUpdate) {
  const cache = yield* PersistentCache;
  yield* cache.update(context.privateDir, 'query_cache', context.key, payload => {
    let prior: QueryCacheEnvelope | undefined;
    if (payload !== undefined) { try { prior = decodeForQuery(context, payload); } catch { /* Rebuild corrupt disposable data. */ } }
    const envelope = replaceQueryEnvelope(context.key, prior, update);
    if (envelope.record) Schema.decodeUnknownSync(queryValueSchema(context.query), { onExcessProperty: 'error' })(envelope.record.value);
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new ConcordError('QueryRefreshOutputLimit', 'Query envelope exceeds 4 MiB');
    return serialized;
  });
});
// @concord-end
/** The detached supervisor owns the bounded scan, never a source publication. */
// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
// @concord-implements docs/feature/local-data-engine/cli.md#历史投影
export const cachedQuery = Effect.fn('cachedQuery')(function*(input: string | undefined, query: Query) {
  const runtime = yield* RuntimeEnvironment;
  const context = yield* queryContext(input, query);
  let observed = yield* readQuery(context);
  const deadline = Date.now() + 500;
  // The pinned engine can also observe a disappearing checkpoint file during
  // pre-open path inspection. Every retry repeats all path and Schema checks.
  while (observed.unavailable !== undefined && Date.now() < deadline) {
    yield* Effect.sleep('10 millis');
    observed = yield* readQuery(context);
  }
  const requester = yield* Effect.serviceOption(QueryRefreshRequest);
  const refresh = yield* Effect.result(Option.isSome(requester) ? requester.value.request(context) : launchDetachedWorker('query-refresh-worker', [context.root, JSON.stringify(query), String(Date.now())], runtime.cwd));
  if (observed.unavailable) return yield* Effect.fail(new ConcordError(observed.unavailableCode ?? 'QueryCacheInvalid', observed.unavailable));
  if (Result.isFailure(refresh) && !observed.record) return yield* Effect.fail(refresh.failure);
  if (!observed.record) return yield* Effect.fail(new ConcordError('QueryPending', 'No readable diagnostic snapshot; background refresh requested. Use --fresh to wait for current sources.', { refresh: observed.error ?? observed.unavailable ?? 'requested' }));
  const { value: stored, ...record } = observed.record;
  const hydrated = yield* Effect.sync(() => hydrateQueryValue(context.root, stored, undefined, runtime));
  const projection = { current: false, ...record, refresh: Result.isSuccess(refresh) ? 'requested' : 'failed',
    ...(observed.lastAttempt ? { lastAttempt: observed.lastAttempt } : {}), ...(observed.error ? { lastError: observed.error } : {}),
    ...(Result.isFailure(refresh) ? { refreshError: refresh.failure.message } : {}),
    bodyChanged: hydrated.bodyChanged, ...(hydrated.bodyUnavailable.length ? { bodyUnavailable: hydrated.bodyUnavailable } : {}) };
  return { ...hydrated.value, projection };
});
// @concord-end
