// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#原生-adapter
// @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md#release-observation-slot
import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostname } from 'node:os';
import { Schema } from "effect";
import { genericPrivateDirectorySync } from "./coordination.ts";
import { CoordinationError, acquireFileLease, assertLeasePath, errno, ownerIsAlive, readLeaseOwner, releaseFileLease, syncLeaseDirectory, type FileLease, type LeaseOwner } from "./file-lease.ts";
import { ConcordError, decode } from "../../model/index.ts";

const RunState = Schema.Struct({
  format: Schema.Literal('concord.observation-state/v1'),
  token: Schema.String,
  phase: Schema.Literals(['running', 'finalizing', 'quarantined']),
  invalidation: Schema.String,
});
type RunState = typeof RunState.Type;
export interface RunLease { readonly lease: FileLease; readonly invalidation: string; }
export interface SlotIdentity { readonly token: string; readonly host: string; readonly pid: number; readonly ownerAlive: boolean | null; readonly startedAt: string; readonly release: string; }
export type ObservationSlotStatus = { readonly status: 'absent' } | ({ readonly status: 'running' } & SlotIdentity) | ({ readonly status: 'blocked'; readonly code: 'CleanupFailed'; readonly message: string } & Partial<SlotIdentity>);
const location = (root: string, environment: Readonly<Record<string, string | undefined>>) => genericPrivateDirectorySync(root, environment);
const statePath = (root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>>) => join(location(root, environment), `observation-${owner.token}.json`);
const quarantinePath = (root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>>) => join(location(root, environment), `observation-${owner.token}.quarantine`);

function readState(root: string, owner: LeaseOwner, environment: Readonly<Record<string, string | undefined>> = {}): RunState {
  const path = statePath(root, owner, environment);
  try {
    assertLeasePath(path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 4096) throw new Error('run state must be a bounded regular file');
    const state = decode(RunState, JSON.parse(readFileSync(path, 'utf8')), path);
    if (state.token !== owner.token || owner.root !== root) throw new Error('run identity does not match this worktree');
    return state;
  } catch (cause) { throw new ConcordError('CleanupFailed', `Observation state is uncertain; preserve it and confirm child-process cleanup before further observations: ${cause instanceof Error ? cause.message : String(cause)}`); }
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

/** Observation only, under publication ownership. Never authorizes observation reclamation. */
export function inspectObservationSlot(root: string, environment: Readonly<Record<string, string | undefined>> = {}): ObservationSlotStatus {
  let identity: SlotIdentity | undefined;
  try {
    const owner = readLeaseOwner(join(location(root, environment), 'observation.lease'), 'recover');
    if (owner === undefined) return { status: 'absent' };
    let ownerAlive: boolean | null;
    try { ownerAlive = ownerIsAlive(owner); } catch { ownerAlive = null; }
    identity = { token: owner.token, host: owner.host, pid: owner.pid, ownerAlive,
      startedAt: lstatSync(join(location(root, environment), 'observation.lease', `${owner.token}.json`)).mtime.toISOString(),
      release: `concord recover --release-observation-slot ${owner.token}` };
    const state = readState(root, owner, environment);
    if (ownerAlive !== true || state.phase !== 'running' || lstatSync(quarantinePath(root, owner, environment), { throwIfNoEntry: false }) !== undefined) {
      return { status: 'blocked', ...identity, code: 'CleanupFailed', message: 'Observation cleanup is unconfirmed; confirm child-process cleanup before releasing its observation slot.' };
    }
    return { status: 'running', ...identity };
  } catch (cause) {
    return { status: 'blocked', ...identity, code: 'CleanupFailed', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Caller holds the document snapshot lease for every state transition. */
export function beginRun(root: string, environment: Readonly<Record<string, string | undefined>> = {}): RunLease {
  const directory = location(root, environment);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  let lease: FileLease;
  try { lease = acquireFileLease(root, directory, 'observation.lease', 'exclusive', 'observation')!; }
  catch (cause) {
    if (cause instanceof CoordinationError && cause.message.includes('publication lease is busy')) {
      const slot = inspectObservationSlot(root, environment);
      const identity = slot.status === 'absent' ? 'Ownership changed; retry.' : `token=${slot.token} pid=${slot.pid} host=${slot.host} ownerAlive=${slot.ownerAlive}; after confirming child-process cleanup: ${slot.release}`;
      throw new ConcordError('RepositoryBusy', `Another observation owns this worktree. ${identity}`, { observationSlot: slot });
    }
    throw cause;
  }
  // If this fails, the complete observation owner remains and its absent state blocks
  // further observations. Do not guess whether a process was started by another entry.
  const invalidation = randomUUID();
  writeState(root, lease.owner, { format: 'concord.observation-state/v1', token: lease.owner.token, phase: 'running', invalidation }, environment);
  return { lease, invalidation };
}

/** An explicit matching token confirms child cleanup; it never authorizes a live or foreign owner. */
export function releaseObservationSlot(root: string, token: string, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const directory = location(root, environment);
  const path = join(directory, 'observation.lease');
  const owner = readLeaseOwner(path, 'release-observation-slot');
  const current = owner ? `token=${owner.token} host=${owner.host} pid=${owner.pid}` : 'no current owner';
  if (!owner || token !== owner.token || owner.host !== hostname() || owner.root !== root) throw new ConcordError('ObservationSlotMismatch', `Observation slot does not match this request: ${current}`);
  if (ownerIsAlive(owner)) throw new ConcordError('ObservationSlotActive', `Observation slot owner is still alive: ${current}; wait for it to finish or terminate it first`);
  // Keep ownership until every registered resource has been reclaimed.
  for (const file of [statePath(root, owner, environment), quarantinePath(root, owner, environment)]) {
    assertLeasePath(file);
    try { unlinkSync(file); } catch (cause) { if (!errno(cause, 'ENOENT')) throw cause; }
  }
  releaseFileLease({ directory, path, owner, mode: 'exclusive' }, 'release-observation-slot');
  syncLeaseDirectory(directory);
}

/** Called before any generic or Trace source mutation, including rollback. */
export function invalidateActiveRun(root: string, environment: Readonly<Record<string, string | undefined>> = {}): void {
  // Uncertain observation cleanup prevents only new external observations.
  // Publishers retain their own CAS/journal guards; observations independently
  // validate source inputs again before accepting their result.
  try {
    const owner = readLeaseOwner(join(location(root, environment), 'observation.lease'), 'publication');
    if (owner === undefined) return;
    const state = readState(root, owner, environment);
    writeState(root, owner, { ...state, invalidation: randomUUID() }, environment);
  } catch { /* Keep uncertain observation ownership intact without blocking writes. */ }
}

export function finalizeRun(root: string, run: RunLease, cleanupOk: boolean, environment: Readonly<Record<string, string | undefined>> = {}): boolean {
  const state = readState(root, run.lease.owner, environment);
  writeState(root, run.lease.owner, { ...state, phase: cleanupOk ? 'finalizing' : 'quarantined' }, environment);
  return state.invalidation !== run.invalidation;
}

export function finishRun(root: string, run: RunLease, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const state = readState(root, run.lease.owner, environment);
  if (state.phase !== 'finalizing') throw new ConcordError('CleanupFailed', 'Only a finalized observation with confirmed resource cleanup may release its ownership');
  releaseFileLease(run.lease, 'observation-finish');
  unlinkSync(statePath(root, run.lease.owner, environment));
  syncLeaseDirectory(location(root, environment));
}

/** Monotonic failure signal: safe even when a failed snapshot acquisition makes
 * a serialized state transition impossible. It can only prevent further observations. */
export function quarantineRun(root: string, run: RunLease, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const path = quarantinePath(root, run.lease.owner, environment);
  assertLeasePath(path);
  let descriptor: number;
  try { descriptor = openSync(path, 'wx', 0o600); }
  catch (cause) { if (errno(cause, 'EEXIST')) return; throw cause; }
  try { writeFileSync(descriptor, run.lease.owner.token); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  syncLeaseDirectory(location(root, environment));
}
