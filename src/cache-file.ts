// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

interface CacheTreeEntry { readonly dev: bigint; readonly ino: bigint; readonly links: bigint; readonly directory: boolean }
const inodeKey = (entry: CacheTreeEntry): string => `${entry.dev}:${entry.ino}`;
const lockPath = (path: string): boolean => basename(path).endsWith('.lock');

/** Every alias of a regular inode must be inside this cache; lock inodes stay unique. */
function inspectTree(path: string): Map<string, CacheTreeEntry> {
  const entries = new Map<string, CacheTreeEntry>();
  const links = new Map<string, { reported: bigint; found: bigint }>();
  const pending = [path];
  while (pending.length > 0) {
    const target = pending.pop()!;
    const stat = lstatSync(target, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new ConcordError('UnsafePath', `Unsupported cache entry: ${target}`);
    const entry = { dev: stat.dev, ino: stat.ino, links: stat.nlink, directory: stat.isDirectory() };
    entries.set(target, entry);
    if (entry.directory) {
      for (const name of readdirSync(target)) pending.push(join(target, name));
    } else {
      if (lockPath(target) && entry.links !== 1n) throw new ConcordError('UnsafePath', `Linked cache ownership lock: ${target}`);
      const key = inodeKey(entry);
      const group = links.get(key) ?? { reported: entry.links, found: 0n };
      if (group.reported !== entry.links) throw new ConcordError('UnsafePath', `Cache link count changed: ${target}`);
      group.found++;
      links.set(key, group);
    }
  }
  if ([...links.values()].some(group => group.reported !== group.found)) throw new ConcordError('UnsafePath', 'Cache has a hard link outside its directory');
  return entries;
}

/** Preflight the complete deletion set before any cache handle is closed or file is removed. */
export function inspectCacheClear(privateDir: string): CacheClearInventory {
  const path = cacheDatabasePath(privateDir);
  const existing = assertCacheDatabaseSafe(path);
  let entries: string[] = [];
  let empty = true;
  if (existing) {
    const tree = inspectTree(path);
    entries = [...tree.keys()].filter(target => dirname(target) === path && basename(target) !== 'owner.hawdb.lock').sort();
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
  verifyOwnership();
  if (!inventory.existing) return;
  safePath(inventory.path);
  const remaining = inspectTree(inventory.path);
  const links = new Map<string, bigint>();
  for (const entry of remaining.values()) if (!entry.directory) links.set(inodeKey(entry), entry.links);
  const unchanged = (path: string, expected: CacheTreeEntry): void => {
    verifyOwnership();
    safePath(path);
    const stat = lstatSync(path, { bigint: true });
    if (stat.isSymbolicLink() || stat.dev !== expected.dev || stat.ino !== expected.ino || stat.isDirectory() !== expected.directory || (!expected.directory && (!stat.isFile() || stat.nlink !== links.get(inodeKey(expected))))) throw new ConcordError('UnsafePath', `Cache entry changed during clear: ${path}`);
  };
  const verifyRemaining = (): void => {
    verifyOwnership();
    const current = inspectTree(inventory.path);
    if (current.size !== remaining.size || [...current].some(([path, entry]) => {
      const expected = remaining.get(path);
      return expected === undefined || expected.dev !== entry.dev || expected.ino !== entry.ino || expected.directory !== entry.directory || !entry.directory && entry.links !== links.get(inodeKey(entry));
    })) throw new ConcordError('UnsafePath', 'Cache membership changed during clear');
  };
  const files = [...remaining].filter(([path, entry]) => !entry.directory && path !== join(inventory.path, 'owner.hawdb.lock')).sort(([a], [b]) => a.localeCompare(b));
  // Keep every engine lease pathname until all selectors, catalogs and branch heads are gone.
  for (const locks of [false, true]) {
    for (const [path, entry] of files) {
      if (lockPath(path) !== locks) continue;
      unchanged(path, entry);
      unlinkSync(path);
      remaining.delete(path);
      const key = inodeKey(entry);
      links.set(key, links.get(key)! - 1n);
    }
    verifyRemaining();
  }
  const directories = [...remaining].filter(([path, entry]) => entry.directory && path !== inventory.path).sort(([a], [b]) => b.split('/').length - a.split('/').length || b.localeCompare(a));
  for (const [path, entry] of directories) {
    unchanged(path, entry);
    if (readdirSync(path).length > 0) throw new ConcordError('UnsafePath', `Cache directory changed during clear: ${path}`);
    rmdirSync(path);
    remaining.delete(path);
  }
  verifyRemaining();
  verifyOwnership();
}
