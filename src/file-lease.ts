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
  readonly reason?: 'occupied' | 'admission-changed';
}> {}

const Token = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/u));
let publicationToken: string | undefined;

/** A dedicated scan process uses its parent's token for its sequential snapshots. */
export function setPublicationToken(token: string): void {
  if (publicationToken !== undefined) throw new Error('Publication token is already configured');
  publicationToken = Schema.decodeUnknownSync(Token)(token);
}

const Owner = Schema.Struct({
  format: Schema.Literal('concord.file-lease/v1'),
  root: Schema.String,
  host: Schema.String,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  token: Token,
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

function busyOwners(mode: FileLease['mode'], owners: readonly LeaseOwner[], operation: string, path: string): CoordinationError {
  const details = owners.map(owner => `pid=${owner.pid} host=${owner.host} mode=${owner.mode ?? 'exclusive'}`).join('; ');
  return new CoordinationError({ operation, path, phase: 'lock', reason: 'occupied', message: `${mode} publication lease is busy (${details}); retry after the operation finishes. For an interrupted operation run concord recover; do not delete the lease directory.` });
}

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

function readLeaseOwners(path: string, operation: string, allowJoiningReaders = false): LeaseOwner[] {
  try {
    assertLeasePath(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined) return [];
    if (!stat.isDirectory()) throw new Error('lease must be a directory; preserve unknown coordination state');
    let entries: string[];
    try { entries = readdirSync(path); }
    catch (cause) { if (errno(cause, 'ENOENT')) return []; throw cause; }
    const owners = entries.flatMap(name => {
      if (!/^[0-9a-f-]{36}\.json$/u.test(name)) throw new Error('lease contains unexpected files; preserve coordination state');
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
    const writers = owners.filter(owner => owner.mode !== 'shared');
    if (writers.length > 1 || owners.length > 1 && writers.length > 0 && (!allowJoiningReaders || owners.some(owner => owner.root !== writers[0]!.root || owner.host !== writers[0]!.host))) {
      throw new Error('lease mixes shared and exclusive owners; preserve coordination state');
    }
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
    const owner: LeaseOwner = { format: 'concord.file-lease/v1', root: resolve(root), host: hostname(), pid: process.pid, token: name === 'publication.lease' ? publicationToken ?? randomUUID() : randomUUID(), ...(mode === 'shared' ? { mode } : {}) };
    temporary = mkdtempSync(join(directory, `.${name}-`));
    const descriptor = openSync(join(temporary, `${owner.token}.json`), 'wx', 0o600);
    try { writeFileSync(descriptor, `${JSON.stringify(owner)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    syncLeaseDirectory(temporary);
    try { renameSync(temporary, path); }
    catch (cause) {
      if (errno(cause, 'EEXIST') || errno(cause, 'ENOTEMPTY')) {
        const owners = readLeaseOwners(path, operation, true);
        if (mode !== 'shared' || owners.some(existing => existing.mode !== 'shared' || existing.root !== owner.root)) throw busyOwners(mode, owners, operation, path);
        let joined = false;
        try {
          const target = join(path, `${owner.token}.json`);
          linkSync(join(temporary, `${owner.token}.json`), target);
          joined = true;
          syncLeaseDirectory(path);
          // The last reader may have left and a writer replaced the directory
          // between the initial scan and link. The link alone grants no access.
          const current = readLeaseOwners(path, operation, true);
          if (!current.some(existing => existing.token === owner.token) || current.some(existing => existing.mode !== 'shared' || existing.root !== owner.root || existing.host !== owner.host)) {
            throw new CoordinationError({ operation, path, phase: 'lock', reason: 'admission-changed', message: 'shared publication lease is busy; ownership changed while joining' });
          }
          return { directory, path, owner, mode };
        } catch (joinCause) {
          if (joined) removeObservedOwner(path, owner);
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
  const current = readLeaseOwners(path, 'release-observed-owner', true).find(value => value.token === owner.token);
  if (current === undefined) return false;
  if (current.root !== owner.root || current.host !== owner.host || current.pid !== owner.pid || current.mode !== owner.mode) throw new Error('lease identity changed before removal; preserve coordination state');
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

/** Successful replies must relinquish publication ownership before idle reuse. */
export function assertScanTokenReleased(path: string, token: string): void {
  if (readLeaseOwners(path, 'scan-idle', true).some(owner => owner.token === token)) throw error('scan-idle', path, new Error('Workspace scan replied while its publication token remains'), 'cleanup');
}

/** Caller must first confirm that this exact owned child process group has exited. */
export function releaseExitedScanToken(root: string, path: string, token: string, pid: number): void {
  const owner = readLeaseOwners(path, 'scan-cleanup', true).find(value => value.token === token);
  if (owner === undefined) return;
  if (owner.root !== resolve(root) || owner.host !== hostname() || owner.pid !== pid || owner.mode !== 'shared') throw error('scan-cleanup', path, new Error('scan token identity changed; preserve coordination state'), 'cleanup');
  removeObservedOwner(path, owner);
}

export function releaseFileLease(lease: FileLease, operation: string): void {
  if (released.has(lease)) return;
  try {
    // A prospective reader may be validating its link while this writer exits.
    // It cannot read protected data until the exclusive token has disappeared.
    const current = readLeaseOwners(lease.path, operation, true).find(owner => owner.token === lease.owner.token);
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
export function recoverFileLease(root: string, path: string, operation: string): readonly string[] {
  try {
    const owners = readLeaseOwners(path, operation, true);
    if (owners.some(owner => owner.root !== resolve(root))) throw new Error('lease belongs to another worktree');
    if (owners.some(ownerIsAlive)) throw new Error('publication lease is busy: its owner is still alive');
    return owners.filter(owner => removeObservedOwner(path, owner)).map(owner => owner.token);
  } catch (cause) { throw error(operation, path, cause, 'cleanup'); }
}

/** Publication only: runner parent death never authorizes runner reclamation. */
export function acquireRecoverablePublicationLease(root: string, directory: string, name: 'publication.lease', mode: FileLease['mode'], operation: string, create = true): FileLease | undefined {
  try { return acquireFileLease(root, directory, name, mode, operation, create); }
  catch (cause) {
    if (!(cause instanceof CoordinationError) || cause.reason !== 'occupied') throw cause;
    const path = join(directory, name);
    const owners = readLeaseOwners(path, operation, true);
    // Inspect the complete observed set before deleting anything. Unknown hosts,
    // EPERM and reused live PIDs retain ownership, as in explicit recovery.
    let dead = false;
    try { dead = owners.length > 0 && owners.every(owner => owner.root === resolve(root) && !ownerIsAlive(owner)); }
    catch { throw cause; }
    if (!dead) throw cause;
    for (const owner of owners) removeObservedOwner(path, owner);
    // One retry only. A new arrival owns its token, even if it subsequently dies.
    return acquireFileLease(root, directory, name, mode, operation, create);
  }
}
