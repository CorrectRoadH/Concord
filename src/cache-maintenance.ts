// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { spawn } from 'node:child_process';
import { cachePhysicalBytes } from './cache-file.js';
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from './hawdb-native-contract.js';
import { workerEntryArgv } from './installation.js';
import type { Repository } from './shared.js';

/** Called only after the command's writable native handle has fully closed. */
export function requestCacheMaintenance(repo: Repository): void {
  if (repo.persistentCache === 'off') return;
  try {
    if (cachePhysicalBytes(repo.privateDir) <= CACHE_MAINTENANCE_THRESHOLD_BYTES) return;
    const child = spawn(process.execPath, [...workerEntryArgv('cache-maintenance-worker'), repo.root], { detached: true, stdio: 'ignore', cwd: repo.root });
    child.once('error', () => { /* a later writable command retries */ });
    child.unref();
  } catch { /* cache maintenance cannot change a command result */ }
}
