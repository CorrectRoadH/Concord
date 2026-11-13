// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#执行管线
// @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md#release-test-slot
import { randomUUID } from "node:crypto";
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { hostname, userInfo } from 'node:os';
import { Schema } from "effect";
import { genericPrivateDirectorySync } from "./coordination.ts";
import { CoordinationError, acquireFileLease, assertLeasePath, errno, ownerIsAlive, readLeaseOwner, releaseFileLease, syncLeaseDirectory, type FileLease, type LeaseOwner } from "./file-lease.ts";
import { ConcordError, decode } from "../../model/index.ts";

const RunState = Schema.Struct({
  format: Schema.Literal('concord.run-state/v1'),
  token: Schema.String,
  phase: Schema.Literals(['running', 'finalizing', 'quarantined']),
  invalidation: Schema.String,
  worktrees: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, dev: Schema.Number, ino: Schema.Number }))),
});
type RunState = typeof RunState.Type;
export interface RunLease { readonly lease: FileLease; readonly invalidation: string; }
export interface SlotIdentity { readonly token: string; readonly host: string; readonly pid: number; readonly ownerAlive: boolean | null; readonly startedAt: string; readonly release: string; }
export type RunnerStatus = { readonly status: 'absent' } | ({ readonly status: 'running' } & SlotIdentity) | ({ readonly status: 'blocked'; readonly code: 'CleanupFailed'; readonly message: string } & Partial<SlotIdentity>);
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
  let identity: SlotIdentity | undefined;
  try {
    const owner = readLeaseOwner(join(location(root, environment), 'runner.lease'), 'recover');
    if (owner === undefined) return { status: 'absent' };
    let ownerAlive: boolean | null;
    try { ownerAlive = ownerIsAlive(owner); } catch { ownerAlive = null; }
    identity = { token: owner.token, host: owner.host, pid: owner.pid, ownerAlive,
      startedAt: lstatSync(join(location(root, environment), 'runner.lease', `${owner.token}.json`)).mtime.toISOString(),
      release: `concord recover --release-test-slot ${owner.token}` };
    const state = readState(root, owner, environment);
    if (ownerAlive !== true || state.phase !== 'running' || lstatSync(quarantinePath(root, owner, environment), { throwIfNoEntry: false }) !== undefined) {
      return { status: 'blocked', ...identity, code: 'CleanupFailed', message: 'Runner cleanup is unconfirmed; confirm child-process cleanup before releasing its test slot.' };
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
  try { lease = acquireFileLease(root, directory, 'runner.lease', 'exclusive', 'test-run')!; }
  catch (cause) {
    if (cause instanceof CoordinationError && cause.message.includes('publication lease is busy')) {
      const slot = inspectRunner(root, environment);
      const identity = slot.status === 'absent' ? 'Ownership changed; retry.' : `token=${slot.token} pid=${slot.pid} host=${slot.host} ownerAlive=${slot.ownerAlive}; after confirming child-process cleanup: ${slot.release}`;
      throw new ConcordError('RepositoryBusy', `Another runner owns this worktree. ${identity}`, { testSlot: slot });
    }
    throw cause;
  }
  // If this fails, the complete runner owner remains and its absent state blocks
  // publication. Do not guess whether a process was started by another entry.
  const invalidation = randomUUID();
  writeState(root, lease.owner, { format: 'concord.run-state/v1', token: lease.owner.token, phase: 'running', invalidation }, environment);
  return { lease, invalidation };
}

/** The runner records its resources before creating them, under publication ownership. */
export function registerRunnerWorktree(root: string, path: string, add: boolean, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const owner = readLeaseOwner(join(location(root, environment), 'runner.lease'), 'test-worktree');
  if (!owner || owner.pid !== process.pid || owner.host !== hostname() || owner.root !== root) throw new ConcordError('CleanupFailed', 'Cannot register a worktree without the current runner owner');
  const state = readState(root, owner, environment);
  const worktrees = (state.worktrees ?? []).filter(item => item.path !== path);
  if (add) { const stat = lstatSync(dirname(path)); worktrees.push({ path, dev: stat.dev, ino: stat.ino }); }
  writeState(root, owner, { ...state, worktrees }, environment);
}

/** An explicit matching token confirms child cleanup; it never authorizes a live or foreign owner. */
export function releaseRunner(root: string, token: string, environment: Readonly<Record<string, string | undefined>> = {}): void {
  const directory = location(root, environment);
  const path = join(directory, 'runner.lease');
  const owner = readLeaseOwner(path, 'release-test-slot');
  const current = owner ? `token=${owner.token} host=${owner.host} pid=${owner.pid}` : 'no current owner';
  if (!owner || token !== owner.token || owner.host !== hostname() || owner.root !== root) throw new ConcordError('TestSlotMismatch', `Test slot does not match this request: ${current}`);
  if (ownerIsAlive(owner)) throw new ConcordError('TestSlotActive', `Test slot owner is still alive: ${current}; wait for it to finish or terminate it first`);
  const state = readState(root, owner, environment);
  const invoke = (args: string[]) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], { env: Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_'))), encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const worktree of state.worktrees ?? []) {
    const scratch = dirname(worktree.path);
    assertLeasePath(worktree.path);
    if (resolve(worktree.path) !== worktree.path || basename(worktree.path) !== 'worktree' || !basename(scratch).startsWith('concord-verify-') || scratch === root || scratch.startsWith(`${root}${sep}`)) throw new ConcordError('CleanupFailed', `Unsafe registered verification worktree: ${worktree.path}`);
    const stat = lstatSync(scratch, { throwIfNoEntry: false });
    if (stat && (!stat.isDirectory() || stat.dev !== worktree.dev || stat.ino !== worktree.ino || stat.uid !== userInfo().uid || (stat.mode & 0o777) !== 0o700)) throw new ConcordError('CleanupFailed', `Verification scratch ownership changed: ${scratch}`);
    try {
      if (invoke(['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${worktree.path}`)) invoke(['worktree', 'remove', '--force', worktree.path]);
      if (stat) rmSync(scratch, { recursive: true });
    } catch (cause) { throw new ConcordError('CleanupFailed', `Could not reclaim verification worktree ${worktree.path}; preserve the test slot`, cause); }
  }
  // Keep ownership until every registered resource has been reclaimed.
  for (const file of [statePath(root, owner, environment), quarantinePath(root, owner, environment)]) {
    assertLeasePath(file);
    try { unlinkSync(file); } catch (cause) { if (!errno(cause, 'ENOENT')) throw cause; }
  }
  releaseFileLease({ directory, path, owner, mode: 'exclusive' }, 'release-test-slot');
  syncLeaseDirectory(directory);
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
  if (state.phase !== 'finalizing' || state.worktrees?.length) throw new ConcordError('CleanupFailed', 'Only a finalized runner with confirmed resource cleanup may release its ownership');
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
