// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#句柄与打开模式
import { assertCacheDatabaseSafe, cacheDatabasePath } from './cache-file.ts';
import { openHawdb } from './hawdb-native.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';

/** Admission failures preserve the cache. Only explicit clear removes data. */
export function openCurrentPersistentCache(privateDir: string, writable: boolean, runtime: RuntimeEnvironmentSnapshot) {
  const path = cacheDatabasePath(privateDir);
  assertCacheDatabaseSafe(path);
  return openHawdb(path, { readOnly: !writable, create: writable }, runtime);
}
