// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#执行管线
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { genericPrivateDirectorySync } from "./coordination.ts";
import { CoordinationError, acquireFileLease, assertLeasePath, errno, ownerIsAlive, readLeaseOwner, releaseFileLease, syncLeaseDirectory, type FileLease, type LeaseOwner } from "./file-lease.ts";
import { ConcordError, decode } from "../../model/index.ts";

const RunState = Schema.Struct({
  format: Schema.Literal('concord.run-state/v1'),
  token: Schema.String,
  phase: Schema.Literals(['running', 'finalizing', 'quarantined']),
  invalidation: Schema.String,
});
type RunState = typeof RunState.Type;
export interface RunLease { readonly lease: FileLease; readonly invalidation: string; }
export type RunnerStatus = { readonly status: 'absent' } | { readonly status: 'running'; readonly token: string } | { readonly status: 'blocked'; readonly code: 'CleanupFailed'; readonly message: string };
const location = (root: string, environment: Readonly<Record<string, string | undefined>>) => genericPrivateDirectorySync(root, environment);
const statePath = (root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>>) => join(location(root, environment), `run-${owner.token}.json`);
const quarantinePath = (root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>>) => join(location(root, environment), `run-${owner.token}.quarantine`);

function readState(root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>> = {}): RunState {
  const path = statePath(root, owner, environment);
  try {
    assertLeasePath(path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new Error('run state must be a bounded regular file');
    const state = decode(RunState, JSON.parse(readFileSync(path, 'utf8')), path);
    if (state.token !== owner.token || owner.root !== root) throw new Error('run identity does not match this worktree');
    return state;
  } catch (cause) { throw new ConcordError('CleanupFailed', `Runner state is uncertain; preserve it and confirm child-process cleanup before further execution or publication: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

function writeState(root: string, owner: LeaseOwner, state: RunState, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const path = statePath(root, owner, environment);
  assertLeasePath(path);
  const temporary = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  const descriptor = openSync(temporary, 'wx', 0o600);
  try {
    try { writeFileSync(descriptor, `${JSON.stringify(state)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(temporary, path); renamed = true;
    syncLeaseDirectory(location(root, environment));
  } finally { if (!renamed) { try { unlinkSync(temporary); } catch (cause) { if (!errno(cause, 'ENOENT')) throw cause; } } }
}

/** Observation only, under publication ownership. Never authorizes runner reclamation. */
export function inspectRunner(root: string, environment: Readonly<Record<string, string | undefined>> = {}): RunnerStatus {
  try {
    const owner = readLeaseOwner(join(location(root, environment), 'runner.lease'), 'recover');
    if (owner === undefined) return { status: 'absent' };
    const state = readState(root, owner, environment);
    if (!ownerIsAlive(owner) || state.phase !== 'running' || lstatSync(quarantinePath(root, owner, environment), { throwIfNoEntry: false }) !== undefined) {
      return { status: 'blocked', code: 'CleanupFailed', message: 'Runner cleanup is unconfirmed; preserve runner.lease and run state. Confirm child-process cleanup before publication.' };
    }
    return { status: 'running', token: owner.token };
  } catch (cause) {
    return { status: 'blocked', code: 'CleanupFailed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Caller holds the document snapshot lease for every state transition. */
export function beginRun(root: string, environment: Readonly<Record<string, string | undefined>> = {}): RunLease {
  const directory = location(root, environment);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let lease: FileLease;
  try { lease = acquireFileLease(root, directory, 'runner.lease', 'exclusive', 'test-run')!; }
  catch (cause) {
    if (cause instanceof CoordinationError && cause.message.includes('publication lease is busy')) throw new ConcordError('RepositoryBusy', 'Another runner owns this worktree. Retry after it finishes; a dead parent requires confirmation of child-process cleanup before its runner state can be removed.');
    throw cause;
  }
  // If this fails, the complete runner owner remains and its absent state blocks
  // publication. Do not guess whether a process was started by another entry.
  const invalidation = randomUUID();
  writeState(root, lease.owner, { format: 'concord.run-state/v1', token: lease.owner.token, phase: 'running', invalidation }, environment);
  return { lease, invalidation };
}

/** Called before any generic or Trace source mutation, including rollback. */
export function invalidateActiveRun(root: string, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const owner = readLeaseOwner(join(location(root, environment), 'runner.lease'), 'publication');
  if (owner === undefined) return;
  const state = readState(root, owner, environment);
  let alive: boolean;
  try { alive = ownerIsAlive(owner); } catch { alive = false; }
  if (!alive || state.phase !== 'running' || lstatSync(quarantinePath(root, owner, environment), { throwIfNoEntry: false }) !== undefined) throw new ConcordError('CleanupFailed', 'A runner has unconfirmed process cleanup; preserve runner.lease and its run state. Confirm child-process cleanup before further publication.');
  writeState(root, owner, { ...state, invalidation: randomUUID() }, environment);
}

export function finalizeRun(root: string, run: RunLease, cleanupOk: boolean, environment: Readonly<Record<string, string | undefined>> = {}): boolean {
  const state = readState(root, run.lease.owner, environment);
  writeState(root, run.lease.owner, { ...state, phase: cleanupOk ? 'finalizing' : 'quarantined' }, environment);
  return state.invalidation !== run.invalidation;
}

export function finishRun(root: string, run: RunLease, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const state = readState(root, run.lease.owner, environment);
  if (state.phase !== 'finalizing') throw new ConcordError('CleanupFailed', 'Only a finalized runner with confirmed cleanup may release its ownership');
  releaseFileLease(run.lease, 'test-finish');
  unlinkSync(statePath(root, run.lease.owner, environment));
  syncLeaseDirectory(location(root, environment));
}

/** Monotonic failure signal: safe even when a failed snapshot acquisition makes
 * a serialized state transition impossible. It can only tighten publication. */
export function quarantineRun(root: string, run: RunLease, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const path = quarantinePath(root, run.lease.owner, environment);
  assertLeasePath(path);
  let descriptor: number;
  try { descriptor = openSync(path, 'wx', 0o600); }
  catch (cause) { if (errno(cause, 'EEXIST')) return; throw cause; }
  try { writeFileSync(descriptor, run.lease.owner.token); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  syncLeaseDirectory(location(root, environment));
}
