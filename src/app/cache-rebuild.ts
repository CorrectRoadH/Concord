// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#句柄与打开模式
import { PersistentCache, HawdbFailure } from '../base/cache/index.js';
import { scanAnnotations, cacheStatus } from '../domain/tests/index.js';
import { scanCode } from '../domain/code/index.js';
import { ConcordError, type Repository } from '../model/index.js';

export function rebuildCache(repo: Repository): ReturnType<typeof scanAnnotations> & {
  readonly codeCache: ReturnType<typeof scanCode>['cache'];
  readonly cacheStatus: ReturnType<typeof cacheStatus>;
} {
  try { PersistentCache.repository(repo).prepareWrite({ create: true }); }
  catch (cause) { throw new ConcordError('CacheRebuildUnavailable', 'Cache rebuild cannot obtain the persistent cache', { reason: cause instanceof HawdbFailure ? cause.code : 'HawdbUnavailable', message: cause instanceof Error ? cause.message : String(cause) }); }
  const annotations = scanAnnotations(repo, { cache: 'rebuild' });
  const code = scanCode(repo, { cache: 'rebuild' });
  const status = cacheStatus(repo);
  if (annotations.cache.status !== 'miss' || !['miss', 'hit'].includes(code.cache.status) || status.status !== 'ready') {
    throw new ConcordError('CacheRebuildUnavailable', 'Cache rebuild did not produce readable current projections', { cache: annotations.cache, codeCache: code.cache, cacheStatus: status });
  }
  return { ...annotations, codeCache: code.cache, cacheStatus: status };
}
