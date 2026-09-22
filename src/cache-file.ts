// @concord-file
// @concord-implements docs/feature/local-sdlc/README.md
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { ConcordError } from './shared.js';

export function cacheDatabasePath(privateDir: string): string {
  return join(privateDir, 'cache.sqlite');
}

function assertCacheSafe(path: string): void {
  let stat;
  try { stat = lstatSync(path); }
  catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return; throw cause; }
  if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
  if (!stat.isFile()) throw new ConcordError('InvalidCache', `Cache paths must be regular files: ${path}`);
}

export function assertCacheDatabaseSafe(path: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) assertCacheSafe(`${path}${suffix}`);
}
