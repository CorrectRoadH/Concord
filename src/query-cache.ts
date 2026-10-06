// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Result, Schema } from 'effect';
import { discoverRoot } from './storage.js';
import { genericPrivateDirectorySync } from './coordination.js';
import { assertLeasePath } from './file-lease.js';
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from './cache-file.js';
import { HawdbFailure, openHawdb } from './hawdb-native.js';
import { TraceGapsValue, TraceShowValue, ReviewRenderValue, hydrateQueryValue, queryValueSchema } from './query-values.js';
import type { QueryScanMessage } from './query-scan-protocol.js';
import { ConcordError, digest, failure } from './shared.js';

export const Query = Schema.Union([
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('gaps')]),
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('show'), Schema.String]),
  Schema.Tuple([Schema.Literal('review'), Schema.Literal('render')]),
  Schema.Tuple([Schema.Literal('review'), Schema.Literal('render'), Schema.String]),
]);
export type Query = typeof Query.Type;
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
export type QueryUpdate = { readonly kind: 'candidate'; readonly message: Extract<QueryScanMessage, { ok: true }> }
  | { readonly kind: 'drift'; readonly scannedAt: number; readonly at: string; readonly changedPaths: readonly string[] }
  | { readonly kind: 'failure'; readonly error: typeof RefreshFailure.Type };
const decodeEnvelope = Schema.decodeUnknownSync(QueryCacheEnvelope, { onExcessProperty: 'error' });
/** One atomic envelope owns the result, most recent structural attempt, and failure. */
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
export function queryRequestSatisfied(prior: Pick<QueryCacheEnvelope, 'record' | 'lastAttempt' | 'error'>, requestedAt: number): boolean {
  return Math.max(prior.record?.scannedAt ?? 0, prior.lastAttempt?.scannedAt ?? 0, prior.error?.scannedAt ?? 0) >= requestedAt;
}
export interface QueryContext { readonly root: string; readonly privateDir: string; readonly key: string; readonly query: Query }
export function queryContext(input: string | undefined, query: Query): QueryContext {
  const root = discoverRoot(input);
  const privateDir = genericPrivateDirectorySync(root);
  const config = join(root, 'concord.config.ts');
  assertLeasePath(config);
  if (lstatSync(config).size > 4 * 1024 * 1024) throw new ConcordError('InvalidConfig', 'Configuration exceeds 4 MiB');
  // The installed build binds projections independently of the consumer cache.
  const directory = dirname(fileURLToPath(import.meta.url));
  const installation = readdirSync(directory).filter(name => name.endsWith('.js')).sort().map(name => [name, digest(readFileSync(join(directory, name)))]);
  for (const target of readdirSync(join(directory, 'native')).sort()) {
    for (const name of ['artifact.json', 'hawdb.node']) installation.push([`native/${target}/${name}`, digest(readFileSync(join(directory, 'native', target, name)))]);
  }
  const key = digest(JSON.stringify([root, privateDir, query, digest(readFileSync(config)), installation]));
  return { root, privateDir, key, query };
}
function decodeForQuery(context: QueryContext, payload: string): QueryCacheEnvelope | undefined {
  const header = Schema.decodeUnknownSync(Schema.Struct({ format: Schema.String }), { onExcessProperty: 'ignore' })(JSON.parse(payload));
  if (['concord.query-cache/v1', 'concord.query-cache/v2'].includes(header.format)) return undefined;
  if (header.format !== 'concord.query-cache/v3') throw new ConcordError('QueryCacheInvalid', 'Unrecognized query cache format');
  const envelope = decodeEnvelope(JSON.parse(payload));
  if (envelope.key !== context.key) throw new ConcordError('QueryCacheInvalid', 'Query cache identity mismatch');
  if (envelope.record) Schema.decodeUnknownSync(queryValueSchema(context.query), { onExcessProperty: 'error' })(envelope.record.value);
  return envelope;
}
export function readQuery(context: QueryContext): { record?: typeof QueryRecord.Type; lastAttempt?: typeof Attempt.Type; error?: typeof RefreshFailure.Type; unavailable?: string; unavailableCode?: string } {
  try {
    const path = cacheDatabasePath(context.privateDir);
    assertLeasePath(path);
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path)) return {};
    const database = openHawdb(path, { readOnly: true, create: false });
    try {
      const payload = database.get('query_cache', [context.key]).find(row => row.key === context.key)?.payload;
      const envelope = payload === undefined ? undefined : decodeForQuery(context, payload);
      return { record: envelope?.record, lastAttempt: envelope?.lastAttempt, error: envelope?.error };
    } finally { database.close(); }
  } catch (cause) { return { unavailable: cause instanceof Error ? cause.message : String(cause), unavailableCode: cause instanceof HawdbFailure ? cause.code : 'QueryCacheInvalid' }; }
}
export function storeQuery(context: QueryContext, update: QueryUpdate): void {
  const path = cacheDatabasePath(context.privateDir);
  assertLeasePath(path); assertCacheDatabaseSafe(path);
  const database = openHawdb(path, { readOnly: false, create: true });
  try {
    let prior: QueryCacheEnvelope | undefined;
    const payload = database.get('query_cache', [context.key])[0]?.payload;
    if (payload !== undefined) { try { prior = decodeForQuery(context, payload); } catch { /* Rebuild corrupt disposable data. */ } }
    const envelope = replaceQueryEnvelope(context.key, prior, update);
    if (envelope.record) Schema.decodeUnknownSync(queryValueSchema(context.query), { onExcessProperty: 'error' })(envelope.record.value);
    const serialized = JSON.stringify(envelope);
    if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new ConcordError('QueryRefreshOutputLimit', 'Query envelope exceeds 4 MiB');
    database.put('query_cache', [{ key: context.key, payload: serialized }]);
  } finally { database.close(); }
}
/** The detached supervisor owns the bounded scan, never a source publication. */
export const cachedQuery = Effect.fn('cachedQuery')(function*(input: string | undefined, query: Query) {
  const context = yield* Effect.try({ try: () => queryContext(input, query), catch: failure });
  let observed = yield* Effect.sync(() => readQuery(context));
  const deadline = Date.now() + 500;
  // The pinned engine can also observe a disappearing checkpoint file during
  // pre-open path inspection. Every retry repeats all path and Schema checks.
  while (observed.unavailable !== undefined && Date.now() < deadline) {
    yield* Effect.sleep('10 millis');
    observed = yield* Effect.sync(() => readQuery(context));
  }
  const refresh = yield* Effect.result(Effect.tryPromise({
    try: () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./query-refresh-worker.js', import.meta.url)), context.root, JSON.stringify(query), String(Date.now())], { detached: true, stdio: 'ignore', cwd: context.root });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    }), catch: failure,
  }));
  if (observed.unavailable) return yield* Effect.fail(new ConcordError(observed.unavailableCode ?? 'QueryCacheInvalid', observed.unavailable));
  if (Result.isFailure(refresh) && !observed.record) return yield* Effect.fail(refresh.failure);
  if (!observed.record) return yield* Effect.fail(new ConcordError('QueryPending', 'No readable diagnostic snapshot; background refresh requested. Use --fresh to wait for current sources.', { refresh: observed.error ?? observed.unavailable ?? 'requested' }));
  const { value: stored, ...record } = observed.record;
  const hydrated = yield* Effect.sync(() => hydrateQueryValue(context.root, stored));
  const projection = { current: false, ...record, refresh: Result.isSuccess(refresh) ? 'requested' : 'failed',
    ...(observed.lastAttempt ? { lastAttempt: observed.lastAttempt } : {}), ...(observed.error ? { lastError: observed.error } : {}),
    ...(Result.isFailure(refresh) ? { refreshError: refresh.failure.message } : {}),
    bodyChanged: hydrated.bodyChanged, ...(hydrated.bodyUnavailable.length ? { bodyUnavailable: hydrated.bodyUnavailable } : {}) };
  return { ...hydrated.value, projection };
});
