// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ConcordError } from './shared.js';
import { assertLeasePath } from './file-lease.js';

export function cacheDatabasePath(privateDir: string): string { return join(privateDir, 'cache.hawdb'); }

export function cacheStat(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); }
  catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined; throw cause; }
}

export function assertCacheDatabaseSafe(path: string): boolean {
  const parent = cacheStat(join(path, '..'));
  if (parent !== undefined && (!parent.isDirectory() || parent.isSymbolicLink())) throw new ConcordError('UnsafePath', `Cache parent is not a real directory: ${path}`);
  const stat = cacheStat(path);
  if (stat === undefined) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ConcordError('UnsafePath', `Cache root must be a real directory: ${path}`);
  return true;
}

export function cacheRootOwnerOnly(path: string): boolean {
  if (!assertCacheDatabaseSafe(path)) return false;
  const names = readdirSync(path);
  if (names.length !== 1 || names[0] !== 'owner.hawdb.lock') return false;
  const lock = cacheStat(join(path, 'owner.hawdb.lock'));
  if (lock === undefined || !lock.isFile() || lock.isSymbolicLink() || lock.nlink !== 1) throw new ConcordError('UnsafePath', 'Cache owner lock must be an unlinked regular file');
  return true;
}

export interface CacheClearInventory { readonly path: string; readonly existing: boolean; readonly empty: boolean; readonly entries: readonly string[] }

/** Preflight the complete deletion set before any cache handle is closed or file is removed. */
export function inspectCacheClear(privateDir: string): CacheClearInventory {
  const path = cacheDatabasePath(privateDir);
  const existing = assertCacheDatabaseSafe(path);
  let entries: string[] = [];
  const count = (target: string): ReturnType<typeof lstatSync> => {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new ConcordError('UnsafePath', `Unsupported cache entry: ${target}`);
    if (stat.isFile() && stat.nlink !== 1) throw new ConcordError('UnsafePath', `Linked cache entry: ${target}`);
    return stat;
  };
  const walk = (directory: string): void => { for (const name of readdirSync(directory)) { const target = join(directory, name); if (count(target)?.isDirectory()) walk(target); } };
  let empty = true;
  if (existing) {
    walk(path);
    const names = readdirSync(path);
    entries = names.filter(name => name !== 'owner.hawdb.lock').sort().map(name => join(path, name));
    empty = entries.length === 0;
    const lock = cacheStat(join(path, 'owner.hawdb.lock'));
    if (lock !== undefined && (!lock.isFile() || lock.nlink !== 1)) throw new ConcordError('UnsafePath', 'Cache owner lock must be an unlinked regular file');
  }
  return { path, existing, empty, entries };
}

export function deleteInspectedCache(inventory: CacheClearInventory, verifyOwnership: () => void): void {
  const safePath = (path: string): void => {
    try { assertLeasePath(path); }
    catch (cause) { throw new ConcordError('UnsafePath', cause instanceof Error ? cause.message : `Unsafe cache path: ${path}`); }
  };
  const remove = (path: string): void => {
    verifyOwnership();
    safePath(path);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1) throw new ConcordError('UnsafePath', `Cache entry changed during clear: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) remove(join(path, name));
      verifyOwnership();
      safePath(path);
      rmdirSync(path);
    } else { unlinkSync(path); }
  };
  verifyOwnership();
  if (inventory.existing) for (const name of readdirSync(inventory.path)) {
    if (name !== 'owner.hawdb.lock') remove(join(inventory.path, name));
  }
  verifyOwnership();
}
