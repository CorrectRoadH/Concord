// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#句柄与打开模式
import { cacheDatabasePath, inspectCacheClear, cachePhysicalBytes } from './cache-file.ts';
import { hawdbIdentity, type HawdbDatabase } from './hawdb-native.ts';
import { decodeEnvelope } from '../../model/index.ts';
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from '../installation/index.ts';

export interface CacheStatus { readonly status: string; readonly path: string; readonly detail?: string; readonly sourceDigest?: string; readonly physicalBytes: number | null }

/** The owner supplies access; inspecting status never acquires a second handle. */
export function inspectCacheStatus(privateDir: string, enabled: boolean, access: () => Pick<HawdbDatabase, 'namespaces' | 'scan'>, release: () => void = () => {}, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})): CacheStatus {
  const path = cacheDatabasePath(privateDir);
  const inspect = (): Omit<CacheStatus, 'physicalBytes'> => {
    try {
      const inventory = inspectCacheClear(privateDir);
      hawdbIdentity(runtime);
      if (!inventory.existing || inventory.empty) return { status: 'empty', path };
      if (!enabled) return { status: 'unavailable', path, detail: 'Persistent cache access is disabled' };
      const database = access();
      const projections = database.namespaces().filter(name => name.endsWith('_cache') || name === 'workspace_projection');
      for (const namespace of projections) database.scan(namespace);
      const payload = projections.includes('workspace_projection') ? database.scan('workspace_projection').find(row => row.key === 'workspace')?.payload : undefined;
      const sourceDigest = payload === undefined ? undefined : decodeEnvelope(JSON.parse(payload)).record?.sourceDigest;
      return { ...(sourceDigest === undefined ? {} : { sourceDigest }), status: projections.length === 0 ? 'empty' : 'ready', path, detail: `projections: ${projections.join(', ')}` };
    } catch (cause) { return { status: 'unavailable', path, detail: cause instanceof Error ? cause.message : String(cause) }; }
  };
  let report: ReturnType<typeof inspect>;
  try { report = inspect(); } finally { release(); }
  try { return { ...report, physicalBytes: cachePhysicalBytes(privateDir) }; }
  catch (cause) { return { status: 'unavailable', path, detail: cause instanceof Error ? cause.message : String(cause), physicalBytes: null }; }
}
