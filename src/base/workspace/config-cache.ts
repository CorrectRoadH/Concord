// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { PersistentCache } from "../cache/index.ts";
import { canonical, objectDigest, type Repository } from "../../model/index.ts";
import { typescriptPackageVersion } from "../process/index.ts";

export function persistNotedConfig(repo: Repository): void {
  const { source, digest, config } = repo.configSnapshot;
  const cache = PersistentCache.repository(repo);
  const key = 'concord.config.ts';
  const existing = cache.get('config_cache', [key])[0];
  if (source === '') {
    if (existing) cache.reconcile('config_cache', [], [key]);
    return;
  }
  const payload = canonical({ config, digest: objectDigest(config), sourceDigest: digest, compiler: typescriptPackageVersion() });
  if (existing?.payload !== payload) cache.put('config_cache', [{ key, payload }]);
}
