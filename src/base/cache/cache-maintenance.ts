// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { spawn } from "node:child_process";
import { cachePhysicalBytes } from "./cache-file.js";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from "../installation/index.js";
import { workerEntryArgv } from "../installation/index.js";
import type { Repository } from "../../model/index.js";

const pending = new Set<string>();
/** Coalesce synchronous writes; the referenced immediate runs before CLI exit. */
export function requestCacheMaintenance(repo: Pick<Repository, 'root' | 'privateDir' | 'persistentCache'>): void {
  if (repo.persistentCache === 'off' || pending.has(repo.privateDir)) return;
  const { root, privateDir } = repo;
  pending.add(privateDir);
  setImmediate(() => {
    pending.delete(privateDir);
    try {
      if (cachePhysicalBytes(privateDir) <= CACHE_MAINTENANCE_THRESHOLD_BYTES) return;
      const child = spawn(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), root], { detached: true, stdio: 'ignore', cwd: root });
      child.once('error', () => { /* a later writable command retries */ });
      child.unref();
    } catch { /* cache maintenance cannot change a command result */ }
  });
}
