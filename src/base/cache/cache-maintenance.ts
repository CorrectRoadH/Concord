// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { spawn } from "node:child_process";
import { processEventEnvironment, recordProcessSpawn } from "../process/index.ts";
import { cachePhysicalBytes } from "./cache-file.ts";
import { CACHE_MAINTENANCE_THRESHOLD_BYTES } from "../installation/index.ts";
import { workerEntryArgv } from "../installation/index.ts";
import type { Repository } from "../../model/index.ts";
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';

const pending = new WeakMap<RuntimeEnvironmentSnapshot, Map<string, Promise<void>>>();
/** Coalesce within the triggering invocation; its owner awaits every queued decision. */
export function requestCacheMaintenance(repo: Pick<Repository, 'root' | 'privateDir' | 'persistentCache'>, runtime: RuntimeEnvironmentSnapshot): void {
  if (repo.persistentCache === 'off') return;
  let tasks = pending.get(runtime);
  if (tasks === undefined) { tasks = new Map(); pending.set(runtime, tasks); }
  if (tasks.has(repo.privateDir)) return;
  const { root, privateDir } = repo;
  let finish!: () => void;
  const task = new Promise<void>(resolve => { finish = resolve; });
  tasks.set(privateDir, task);
  const complete = () => { tasks.delete(privateDir); finish(); };
  setImmediate(() => {
    try {
      if (cachePhysicalBytes(privateDir) <= CACHE_MAINTENANCE_THRESHOLD_BYTES) return complete();
      const command = [process.execPath, ...workerEntryArgv('cache-maintenance-worker'), root];
      const env = processEventEnvironment(command, runtime.env);
      const child = spawn(process.execPath, command.slice(1), { detached: true, stdio: 'ignore', cwd: runtime.cwd, env });
      child.once('spawn', () => { recordProcessSpawn(command, env, child.pid); complete(); });
      child.once('error', complete);
      child.unref();
    } catch { complete(); /* Disposable maintenance cannot change a command result. */ }
  });
}

export async function awaitCacheMaintenance(runtime: RuntimeEnvironmentSnapshot): Promise<void> {
  const tasks = pending.get(runtime);
  while (tasks !== undefined && tasks.size > 0) await Promise.all(tasks.values());
}
