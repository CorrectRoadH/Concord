// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Data, Schema } from 'effect';

export class CoordinationError extends Data.TaggedError('CoordinationError')<{
  readonly operation: string;
  readonly phase: 'git-private' | 'migration' | 'lock' | 'cleanup';
  readonly path?: string;
  readonly message: string;
}> {}

const Owner = Schema.Struct({
  format: Schema.Literal('concord.file-lease/v1'),
  root: Schema.String,
  host: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  token: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u)),
  mode: Schema.optional(Schema.Literal('shared')),
});
export type LeaseOwner = typeof Owner.Type;
export interface FileLease {
  readonly directory: string;
  readonly path: string;
  readonly owner: LeaseOwner;
  readonly mode: 'shared' | 'exclusive';
}
const released = new WeakSet<FileLease>();
export const errno = (cause: unknown, code: string): boolean => cause instanceof Error && 'code' in cause && cause.code === code;
const error = (operation: string, path: string, cause: unknown, phase: CoordinationError['phase'] = 'lock'): CoordinationError => cause instanceof CoordinationError ? cause : new CoordinationError({ operation, phase, path, message: cause instanceof Error ? cause.message : String(cause) });

export function assertLeasePath(path: string): void {
  let part: string = sep;
  for (const segment of resolve(path).slice(sep.length).split(sep)) {
    part = join(part, segment);
    const stat = lstatSync(part, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error(`symbolic links are not permitted in coordination paths: ${part}`);
  }
}

export function syncLeaseDirectory(path: string): void {
  const descriptor = openSync(path, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

/** An absent or empty directory has no owner. Never infer ownership from its age. */
export function readLeaseOwner(path: string, operation: string): LeaseOwner | undefined {
  const owners = readLeaseOwners(path, operation);
  if (owners.length > 1) throw error(operation, path, new Error('lease has multiple shared owners'));
  return owners[0];
}

function readLeaseOwners(path: string, operation: string): LeaseOwner[] {
  try {
    assertLeasePath(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) return [];
    if (!stat.isDirectory()) throw new Error('lease must be a directory; preserve unknown coordination state');
    let entries: string[];
    try { entries = readdirSync(path); }
    catch (cause) { if (errno(cause, 'ENOENT')) return []; throw cause; }
    const owners = entries.flatMap(name => {
      const file = join(path, name);
      const ownerStat = lstatSync(file, { throwIfNoEntry: false });
      if (ownerStat === undefined) return [];
      if (!ownerStat.isFile() || ownerStat.isSymbolicLink() || ownerStat.size > 4096) throw new Error('lease owner must be one bounded regular file');
      let source: string;
      try { source = readFileSync(file, 'utf8'); }
      catch (cause) { if (errno(cause, 'ENOENT')) return []; throw cause; }
      const owner = Schema.decodeUnknownSync(Owner, { onExcessProperty: 'error' })(JSON.parse(source));
      if (owner.root !== resolve(owner.root) || owner.host.length === 0 || name !== `${owner.token}.json`) throw new Error('lease owner identity does not match its path');
      return [owner];
    });
    if (owners.length > 1 && owners.some(owner => owner.mode !== 'shared')) throw new Error('lease mixes shared and exclusive owners; preserve coordination state');
    return owners;
  } catch (cause) { throw error(operation, path, cause); }
}

export function acquireFileLease(root: string, directory: string, name: string, mode: FileLease['mode'], operation: string, create = true, attempt = 0): FileLease | undefined {
  const path = join(directory, name);
  let temporary: string | undefined;
  let published = false;
  try {
    assertLeasePath(path);
    if (!create && lstatSync(path, { throwIfNoEntry: false }) === undefined) return undefined;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const owner: LeaseOwner = { format: 'concord.file-lease/v1', root: resolve(root), host: hostname(), pid: process.pid, token: randomUUID(), ...(mode === 'shared' ? { mode } : {}) };
    temporary = mkdtempSync(join(directory, `.${name}-`));
    const descriptor = openSync(join(temporary, `${owner.token}.json`), 'wx', 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(owner)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    syncLeaseDirectory(temporary);
    try { renameSync(temporary, path); }
    catch (cause) {
      if (errno(cause, 'EEXIST') || errno(cause, 'ENOTEMPTY')) {
        const owners = readLeaseOwners(path, operation);
        if (mode !== 'shared' || owners.some(existing => existing.mode !== 'shared' || existing.root !== owner.root)) throw new Error(`${mode} publication lease is busy; retry after the operation finishes, or recover a dead owner`);
        try {
          const target = join(path, `${owner.token}.json`);
          linkSync(join(temporary, `${owner.token}.json`), target);
          syncLeaseDirectory(path);
          return { directory, path, owner, mode };
        } catch (joinCause) {
          if (errno(joinCause, 'ENOENT') && attempt < 3) return acquireFileLease(root, directory, name, mode, operation, create, attempt + 1);
          throw joinCause;
        }
      }
      throw cause;
    }
    published = true;
    syncLeaseDirectory(directory);
    return { directory, path, owner, mode };
  } catch (cause) { throw error(operation, path, cause); }
  finally {
    // Only a private, unpublished temporary is recursively removable. A failed
    // post-rename fsync leaves a complete, explainable owner for explicit recovery.
    if (temporary !== undefined && !published) rmSync(temporary, { recursive: true, force: true });
  }
}

function removeObservedOwner(path: string, owner: LeaseOwner): boolean {
  try { unlinkSync(join(path, `${owner.token}.json`)); }
  catch (cause) { if (errno(cause, 'ENOENT')) return false; throw cause; }
  try { rmdirSync(path); }
  catch (cause) {
    // A newly published nonempty lease may already have replaced the empty dir.
    if (!errno(cause, 'ENOENT') && !errno(cause, 'ENOTEMPTY') && !errno(cause, 'EEXIST')) throw cause;
  }
  syncLeaseDirectory(dirname(path));
  return true;
}

export function releaseFileLease(lease: FileLease, operation: string): void {
  if (released.has(lease)) return;
  try {
    const current = lease.mode === 'shared' ? readLeaseOwners(lease.path, operation).find(owner => owner.token === lease.owner.token) : readLeaseOwner(lease.path, operation);
    if (current === undefined || current.token !== lease.owner.token) { released.add(lease); return; }
    if (current.root !== lease.owner.root || current.host !== lease.owner.host || current.pid !== lease.owner.pid) throw new Error('lease identity changed; preserve coordination state');
    removeObservedOwner(lease.path, current);
    released.add(lease);
  } catch (cause) { throw error(operation, lease.path, cause, 'cleanup'); }
}

export function ownerIsAlive(owner: LeaseOwner): boolean {
  if (owner.host !== hostname()) throw new Error('lease belongs to another host; process ownership is unknown');
  try { process.kill(owner.pid, 0); return true; }
  catch (cause) { if (errno(cause, 'ESRCH')) return false; throw cause; }
}

/** Only document leases are reclaimable this way; dead parents do not prove dead runners. */
export function recoverFileLease(root: string, path: string, operation: string): void {
  try {
    const owners = readLeaseOwners(path, operation);
    if (owners.some(owner => owner.root !== resolve(root))) throw new Error('lease belongs to another worktree');
    if (owners.some(ownerIsAlive)) throw new Error('publication lease is busy: its owner is still alive');
    for (const owner of owners) removeObservedOwner(path, owner);
  } catch (cause) { throw error(operation, path, cause, 'cleanup'); }
}
