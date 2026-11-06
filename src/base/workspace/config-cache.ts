// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { Schema } from "effect";
import { assertCacheDatabaseSafe, cacheDatabasePath, cacheRootOwnerOnly } from "../cache/index.ts";
import { PersistentCache } from "../cache/index.ts";
import { openHawdb } from "../cache/index.ts";
import { canonical, decode, objectDigest, ProjectSchema, type shared_ProjectConfig as ProjectConfig, type Repository } from "../../model/index.ts";
import { typescriptPackageVersion } from "../process/index.ts";

const CachedConfigSchema = Schema.Struct({ config: ProjectSchema, digest: Schema.String });

function cacheKey(privateDir: string, sourceDigest: string): string {
  return objectDigest({ privateDir, parser: `typescript-ast/${typescriptPackageVersion()}/concord-config-parse/v1`, sourceDigest });
}

/** Constructor reads before Repository is available: use a short existing-only handle. */
export function readCachedProjectConfig(privateDir: string, sourceDigest: string): ProjectConfig | undefined {
  const path = cacheDatabasePath(privateDir);
  try {
    if (!assertCacheDatabaseSafe(path) || cacheRootOwnerOnly(path)) return undefined;
    const database = openHawdb(path, { readOnly: true, create: false });
    try {
      const row = database.get('config_cache', [cacheKey(privateDir, sourceDigest)])[0];
      if (row === undefined) return undefined;
      const value = decode(CachedConfigSchema, JSON.parse(row.payload), 'config cache');
      return value.digest === objectDigest(value.config) ? value.config : undefined;
    } finally { database.close(); }
  } catch { return undefined; }
}

export function persistNotedConfig(repo: Repository): void {
  const { source, digest, config } = repo.configSnapshot;
  if (source === '') return;
  const payload = canonical({ config, digest: objectDigest(config) });
  const key = cacheKey(repo.privateDir, digest);
  if (PersistentCache.repository(repo).get('config_cache', [key])[0]?.payload === payload) return;
  PersistentCache.repository(repo).put('config_cache', [{ key, payload }]);
}
