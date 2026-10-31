// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#句柄与打开模式
import { Effect, Schema } from 'effect';
import { PersistentCache, HawdbFailure, type CacheStatus } from '../base/cache/index.js';
import { Workspace } from '../base/workspace/index.js';
import { Sources } from '../base/sources/index.js';
import { scanAnnotations, cacheStatus } from '../domain/tests/index.js';
import { scanCode } from '../domain/code/index.js';
import { AnnotatedCaseSchema, ConcordError, failure, type Repository } from '../model/index.js';

const Counter = Schema.Struct({ status: Schema.String, hits: Schema.Number, misses: Schema.Number, path: Schema.String, detail: Schema.optional(Schema.String) });
const Projection = Schema.Struct({ cases: Schema.Array(AnnotatedCaseSchema), findings: Schema.Array(Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) })), files: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })), digest: Schema.String, cache: Counter, codeCache: Counter });
function compile(repo: Repository): typeof Projection.Type {
  const annotations = scanAnnotations(repo, { cache: 'rebuild' });
  const code = scanCode(repo, { cache: 'rebuild' });
  return { ...annotations, codeCache: code.cache };
}

export function finishCacheRebuild(input: unknown, status: CacheStatus): typeof Projection.Type & { readonly cacheStatus: CacheStatus } {
  const value = Schema.decodeUnknownSync(Projection, { onExcessProperty: 'error' })(input);
  if (value.cache.status !== 'miss' || !['miss', 'hit'].includes(value.codeCache.status) || status.status !== 'ready') {
    throw new ConcordError('CacheRebuildUnavailable', 'Cache rebuild did not produce readable current projections', { cache: value.cache, codeCache: value.codeCache, cacheStatus: status });
  }
  return { ...value, cacheStatus: status };
}

export function rebuildCache(repo: Repository): ReturnType<typeof finishCacheRebuild> {
  try { PersistentCache.repository(repo).prepareWrite({ create: true }); }
  catch (cause) { throw new ConcordError('CacheRebuildUnavailable', 'Cache rebuild cannot obtain the persistent cache', { reason: cause instanceof HawdbFailure ? cause.code : 'HawdbUnavailable', message: cause instanceof Error ? cause.message : String(cause) }); }
  const value = compile(repo);
  return finishCacheRebuild(value, cacheStatus(repo));
}

/** Computes derivations only; the caller's persistent owner publishes the batches. */
export const computeCacheRebuild = Effect.fn('computeCacheRebuild')(function*(root: string) {
  const repo = yield* (yield* Workspace).openRead(root, { access: 'read', optimistic: true });
  return yield* (yield* Sources).snapshot(repo, Effect.try({ try: () => compile(repo), catch: failure }));
});
