// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { genericPrivateDirectorySync } from './coordination.js';
import { CoordinationError, acquireFileLease, assertLeasePath, errno, ownerIsAlive, readLeaseOwner, releaseFileLease, syncLeaseDirectory, type FileLease, type LeaseOwner } from './file-lease.js';
import { ConcordError, decode } from './shared.js';

const RunState = Schema.Struct({
  format: Schema.Literal('concord.run-state/v1'),
  token: Schema.String,
  phase: Schema.Literals(['running', 'finalizing', 'quarantined']),
  invalidated: Schema.Boolean,
});
type RunState = typeof RunState.Type;
export interface RunLease { readonly lease: FileLease; }
const location = (root: string) => genericPrivateDirectorySync(root);
const statePath = (root: string, owner: LeaseOwner) => join(location(root), `run-${owner.token}.json`);
const quarantinePath = (root: string, owner: LeaseOwner) => join(location(root), `run-${owner.token}.quarantine`);

function readState(root: string, owner: LeaseOwner): RunState {
  const path = statePath(root, owner);
  try {
    assertLeasePath(path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new Error('run state must be a bounded regular file');
    const state = decode(RunState, JSON.parse(readFileSync(path, 'utf8')), path);
    if (state.token !== owner.token || owner.root !== root) throw new Error('run identity does not match this worktree');
    return state;
  } catch (cause) { throw new ConcordError('CleanupFailed', `Runner state is uncertain; preserve it and confirm child-process cleanup before further execution or publication: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

function writeState(root: string, owner: LeaseOwner, state: RunState): void {
  const path = statePath(root, owner);
  assertLeasePath(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(descriptor, `${JSON.stringify(state)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path); renamed = true;
    syncLeaseDirectory(location(root));
  } finally { if (!renamed) { try { unlinkSync(temporary); } catch (cause) { if (!errno(cause, 'ENOENT')) throw cause; } } }
}

/** Caller holds the document snapshot lease for every state transition. */
export function beginRun(root: string): RunLease {
  const directory = location(root);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let lease: FileLease;
  try { lease = acquireFileLease(root, directory, 'runner.lease', 'exclusive', 'test-run')!; }
  catch (cause) {
    if (cause instanceof CoordinationError && cause.message.includes('publication lease is busy')) throw new ConcordError('RepositoryBusy', 'Another runner owns this worktree. Retry after it finishes; a dead parent requires confirmation of child-process cleanup before its runner state can be removed.');
    throw cause;
  }
  // If this fails, the complete runner owner remains and its absent state blocks
  // publication. Do not guess whether a process was started by another entry.
  writeState(root, lease.owner, { format: 'concord.run-state/v1', token: lease.owner.token, phase: 'running', invalidated: false });
  return { lease };
}

/** Called before any generic or Trace source mutation, including rollback. */
export function invalidateActiveRun(root: string): void {
  const owner = readLeaseOwner(join(location(root), 'runner.lease'), 'publication');
  if (owner === undefined) return;
  const state = readState(root, owner);
  let alive: boolean;
  try { alive = ownerIsAlive(owner); } catch { alive = false; }
  if (!alive || state.phase !== 'running' || lstatSync(quarantinePath(root, owner), { throwIfNoEntry: false }) !== undefined) throw new ConcordError('CleanupFailed', 'A runner has unconfirmed process cleanup; preserve runner.lease and its run state. Confirm child-process cleanup before further publication.');
  if (!state.invalidated) writeState(root, owner, { ...state, invalidated: true });
}

export function finalizeRun(root: string, run: RunLease, cleanupOk: boolean): boolean {
  const state = readState(root, run.lease.owner);
  writeState(root, run.lease.owner, { ...state, phase: cleanupOk ? 'finalizing' : 'quarantined' });
  return state.invalidated;
}

export function finishRun(root: string, run: RunLease): void {
  const state = readState(root, run.lease.owner);
  if (state.phase !== 'finalizing') throw new ConcordError('CleanupFailed', 'Only a finalized runner with confirmed cleanup may release its ownership');
  releaseFileLease(run.lease, 'test-finish');
  unlinkSync(statePath(root, run.lease.owner));
  syncLeaseDirectory(location(root));
}

/** Monotonic failure signal: safe even when a failed snapshot acquisition makes
 * a serialized state transition impossible. It can only tighten publication. */
export function quarantineRun(root: string, run: RunLease): void {
  const path = quarantinePath(root, run.lease.owner);
  assertLeasePath(path);
  let descriptor: number;
  try { descriptor = openSync(path, 'wx', 0o600); }
  catch (cause) { if (errno(cause, 'EEXIST')) return; throw cause; }
  try { writeFileSync(descriptor, run.lease.owner.token); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  syncLeaseDirectory(location(root));
}
