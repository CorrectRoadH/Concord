// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { PersistentCache } from "../cache/index.ts";
import { canonical, objectDigest, type Repository } from "../../model/index.ts";
import { typescriptPackageVersion } from "../process/index.ts";

function cacheKey(privateDir: string, sourceDigest: string): string {
  return objectDigest({ privateDir, parser: `typescript-ast/${typescriptPackageVersion()}/concord-config-parse/v1`, sourceDigest });
}

export function persistNotedConfig(repo: Repository): void {
  const { source, digest, config } = repo.configSnapshot;
  if (source === '') return;
  const payload = canonical({ config, digest: objectDigest(config) });
  const key = cacheKey(repo.privateDir, digest);
  if (PersistentCache.repository(repo).get('config_cache', [key])[0]?.payload === payload) return;
  PersistentCache.repository(repo).put('config_cache', [{ key, payload }]);
}
