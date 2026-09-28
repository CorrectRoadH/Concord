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
import { ConcordError, digest, failure } from './shared.js';

export const Query = Schema.Union([
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('gaps')]),
  Schema.Tuple([Schema.Literal('trace'), Schema.Literal('show'), Schema.String]),
  Schema.Tuple([Schema.Literal('review'), Schema.Literal('render')]),
  Schema.Tuple([Schema.Literal('review'), Schema.Literal('render'), Schema.String]),
]);
export type Query = typeof Query.Type;
const Record = Schema.Struct({ builtAt: Schema.String, scannedAt: Schema.Number, value: Schema.Json });
const RefreshFailure = Schema.Struct({ failedAt: Schema.String, scannedAt: Schema.Number, code: Schema.String, message: Schema.String });
const Envelope = Schema.Struct({
  format: Schema.Literal('concord.query-cache/v2'), key: Schema.String,
  record: Schema.optional(Record), error: Schema.optional(RefreshFailure),
});
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
export function readQuery(context: QueryContext): { record?: typeof Record.Type; error?: typeof RefreshFailure.Type; unavailable?: string; unavailableCode?: string } {
  try {
    const path = cacheDatabasePath(context.privateDir);
    assertLeasePath(path);
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path)) return {};
    const database = openHawdb(path, { readOnly: true, create: false });
    try {
      const rows = database.get('query_cache', [context.key]);
      const payload = rows.find(row => row.key === context.key)?.payload;
      const envelope = payload === undefined ? undefined : Schema.decodeUnknownSync(Envelope, { onExcessProperty: 'error' })(JSON.parse(payload));
      if (envelope && envelope.key !== context.key) throw new Error('Query cache identity mismatch');
      return { record: envelope?.record, error: envelope?.error };
    } finally { database.close(); }
  } catch (cause) { return { unavailable: cause instanceof Error ? cause.message : String(cause), unavailableCode: cause instanceof HawdbFailure ? cause.code : 'QueryCacheInvalid' }; }
}
export function storeQuery(context: QueryContext, value: unknown, error?: ConcordError, scannedAt = Date.now()): void {
  const path = cacheDatabasePath(context.privateDir);
  assertLeasePath(path); assertCacheDatabaseSafe(path);
  const database = openHawdb(path, { readOnly: false, create: true });
  try {
    const prior = database.get('query_cache', [context.key])[0]?.payload;
    let record: typeof Record.Type | undefined;
    // A corrupt cache may be replaced, but is never served as a valid snapshot.
    if (prior !== undefined) {
      try {
        const envelope = Schema.decodeUnknownSync(Envelope, { onExcessProperty: 'error' })(JSON.parse(prior));
        if (envelope.key === context.key) record = envelope.record;
      } catch { /* rebuild */ }
    }
    const payload = Schema.decodeUnknownSync(Envelope, { onExcessProperty: 'error' })({
      format: 'concord.query-cache/v2', key: context.key,
      ...(error === undefined ? { record: { builtAt: new Date().toISOString(), scannedAt, value } }
        : { ...(record ? { record } : {}), error: { failedAt: new Date().toISOString(), scannedAt, code: error.code, message: error.message.slice(0, 4096) } }),
    });
    database.put('query_cache', [{ key: context.key, payload: JSON.stringify(payload) }]);
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
  const projection = { current: false, builtAt: observed.record.builtAt, refresh: Result.isSuccess(refresh) ? 'requested' : 'failed', ...(observed.error ? { lastError: observed.error } : {}), ...(Result.isFailure(refresh) ? { refreshError: refresh.failure.message } : {}) };
  const value = observed.record.value;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...value, projection } : { operation: 'cached-query', body: value, projection };
});
