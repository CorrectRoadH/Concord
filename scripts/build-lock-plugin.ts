import type { Plugin } from 'vite-plus';
import { Effect } from 'effect';
import { acquireBuildLock, type BuildLock } from './build-lock.js';

/** Every Vite build shares the lease held by checks and measurements. */
export function buildLockPlugin(port?: number): Plugin {
  let lock: BuildLock | undefined;
  const release = async () => { const active = lock; lock = undefined; await active?.release(); };
  return {
    name: 'concord-build-lock', apply: 'build',
    async configResolved() { lock = await Effect.runPromise(acquireBuildLock(undefined, port)); },
    async buildEnd(error) { if (error) await release(); },
    async closeBundle() { await release(); },
  };
}
