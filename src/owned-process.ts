// @concord-file owned-command-process
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
// Scope-owned, detached process groups for repository commands.
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { Context, Data, Deferred, Effect, Layer, Option, Scope } from 'effect';

const OUTPUT_LIMIT = 4 * 1024 * 1024;
export type OwnedTermination = 'timeout' | 'cancelled' | 'output-limit';
export interface OwnedProcessOptions { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number; }
export interface OwnedProcessGroupCleanup { readonly owned: boolean; readonly checked: boolean; readonly aliveAfterLeaderClose: boolean | null; readonly groupId?: number; readonly signalsSent: readonly NodeJS.Signals[]; readonly gone: boolean | null; readonly detail: string; }
export interface OwnedProcessResult {
  readonly command: readonly string[]; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean; readonly cancelled: boolean; readonly outputLimitExceeded: boolean;
  readonly stdout: string; readonly stderr: string; readonly error?: string; readonly processGroupOwned: boolean; readonly groupCleanup: OwnedProcessGroupCleanup;
}
export class OwnedProcessError extends Data.TaggedError('OwnedProcessError')<{ readonly operation: 'spawn' | 'observe'; readonly detail: string; }> {}
export interface OwnedProcessService {
  readonly run: (command: readonly string[], options: OwnedProcessOptions) => Effect.Effect<OwnedProcessResult, OwnedProcessError, Scope.Scope>;
  readonly requestStop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly stop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly forceKill: Effect.Effect<void>; readonly activeCount: Effect.Effect<number>; readonly awaitIdle: Effect.Effect<void>;
}
export class OwnedProcess extends Context.Service<OwnedProcess, OwnedProcessService>()('concord/OwnedProcess') {}
export const runOwnedProcess = (command: readonly string[], options: OwnedProcessOptions) => Effect.flatMap(OwnedProcess, (service) => service.run(command, options));
export const hasConfirmedOwnedGroupCleanup = (result: Pick<OwnedProcessResult, 'processGroupOwned' | 'groupCleanup'>): boolean => !result.processGroupOwned || result.groupCleanup.gone === true;
export const hasSuccessfulOwnedProcessResult = (result: Pick<OwnedProcessResult, 'exitCode' | 'signal' | 'timedOut' | 'cancelled' | 'outputLimitExceeded' | 'error' | 'processGroupOwned' | 'groupCleanup'>): boolean => result.exitCode === 0 && result.signal === null && !result.timedOut && !result.cancelled && !result.outputLimitExceeded && result.error === undefined && hasConfirmedOwnedGroupCleanup(result);

type GroupPresence = 'alive' | 'zombie-only' | 'gone' | 'unknown';
function groupPresence(groupId: number): GroupPresence {
  try {
    process.kill(-groupId, 0);
    if (process.platform === 'linux') {
      const states = readdirSync('/proc', { withFileTypes: true }).flatMap((entry) => {
        if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) return [];
        try { const stat = readFileSync(`/proc/${entry.name}/stat`, 'utf8'); const fields = stat.slice(stat.lastIndexOf(')') + 1).trimStart().split(/\s+/u); return Number(fields[2]) === groupId ? [fields[0] === 'Z' || fields[0] === 'X'] : []; } catch { return []; }
      });
      if (states.length > 0 && states.every(Boolean)) return 'zombie-only';
    }
    return 'alive';
  } catch (cause) { return (cause as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'; }
}
interface Active { readonly child: ChildProcess; readonly command: readonly string[]; readonly groupOwned: boolean; readonly groupId?: number; readonly signals: NodeJS.Signals[]; readonly closed: Deferred.Deferred<readonly [number | null, NodeJS.Signals | null]>; readonly shutdown: Deferred.Deferred<OwnedProcessResult>; stdout: string; stderr: string; bytes: number; error?: string; termination?: OwnedTermination; }
const none = (detail: string): OwnedProcessGroupCleanup => ({ owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail });
function signal(active: Active, name: NodeJS.Signals, reason?: OwnedTermination): void { if (reason !== undefined && active.termination === undefined) active.termination = reason; try { if (active.groupOwned && active.groupId !== undefined) { process.kill(-active.groupId, name); active.signals.push(name); } else active.child.kill(name); } catch { /* already closed */ } }
function waitGroup(groupId: number, remaining: number): Effect.Effect<GroupPresence> { return Effect.suspend(() => { const state = groupPresence(groupId); return state === 'alive' && remaining > 0 ? Effect.sleep(Math.min(100, remaining)).pipe(Effect.andThen(waitGroup(groupId, remaining - 100))) : Effect.succeed(state); }); }
function cleanup(active: Active, graceMs: number): Effect.Effect<OwnedProcessGroupCleanup> {
  if (!active.groupOwned || active.groupId === undefined) return Effect.succeed(none('no detached POSIX process group was created'));
  const initial = groupPresence(active.groupId); const result = (state: GroupPresence, detail: string): OwnedProcessGroupCleanup => ({ owned: true, checked: true, aliveAfterLeaderClose: initial === 'alive', groupId: active.groupId, signalsSent: active.signals, gone: state === 'gone' || state === 'zombie-only', detail });
  if (initial !== 'alive') return Effect.succeed(result(initial, initial === 'unknown' ? 'could not verify owned process group' : 'owned process group has no running members'));
  return Effect.sync(() => signal(active, 'SIGTERM')).pipe(Effect.andThen(waitGroup(active.groupId, graceMs)), Effect.flatMap((afterTerm) => afterTerm === 'alive' ? Effect.sync(() => signal(active, 'SIGKILL')).pipe(Effect.andThen(waitGroup(active.groupId!, graceMs)), Effect.map((afterKill) => result(afterKill, 'owned process group required TERM/grace/KILL cleanup'))) : Effect.succeed(result(afterTerm, 'owned process group drained after TERM grace'))));
}
function makeResult(active: Active, close: readonly [number | null, NodeJS.Signals | null], graceMs: number): Effect.Effect<OwnedProcessResult> { return cleanup(active, graceMs).pipe(Effect.map((groupCleanup) => ({ command: active.command, exitCode: close[0], signal: close[1], timedOut: active.termination === 'timeout', cancelled: active.termination === 'cancelled', outputLimitExceeded: active.termination === 'output-limit', stdout: active.stdout, stderr: active.stderr, ...(active.error === undefined ? {} : { error: active.error }), processGroupOwned: active.groupOwned, groupCleanup }))); }
function stop(active: Active, graceMs: number, reason: OwnedTermination, first: NodeJS.Signals = 'SIGTERM'): Effect.Effect<OwnedProcessResult> { return Effect.uninterruptible(Effect.gen(function* () { const known = yield* Deferred.poll(active.shutdown); if (Option.isSome(known)) return yield* known.value; signal(active, first, reason); const closed = yield* Deferred.await(active.closed).pipe(Effect.timeoutOption(graceMs)); if (Option.isNone(closed)) { signal(active, 'SIGKILL'); const killed = yield* Deferred.await(active.closed); const result = yield* makeResult(active, killed, graceMs); yield* Deferred.succeed(active.shutdown, result); return result; } const result = yield* makeResult(active, closed.value, graceMs); yield* Deferred.succeed(active.shutdown, result); return result; })); }
function acquire(command: readonly string[], options: OwnedProcessOptions, active: Set<Active>, graceMs: number): Effect.Effect<Active, OwnedProcessError> { return Effect.gen(function* () { const closed = yield* Deferred.make<readonly [number | null, NodeJS.Signals | null]>(); const shutdown = yield* Deferred.make<OwnedProcessResult>(); return yield* Effect.try({ try: () => { if (command[0] === undefined) throw new Error('owned process command must contain an executable'); const groupOwned = process.platform !== 'win32'; const env = { ...(options.env ?? process.env) }; delete env.NODE_TEST_CONTEXT; const child = spawn(command[0], command.slice(1), { cwd: options.cwd, env, detached: groupOwned, stdio: ['ignore', 'pipe', 'pipe'] }); const entry: Active = { child, command, groupOwned, ...(groupOwned && child.pid !== undefined && child.pid !== process.pid ? { groupId: child.pid } : {}), signals: [], closed, shutdown, stdout: '', stderr: '', bytes: 0 };
      let outputKillTimer: ReturnType<typeof setTimeout> | undefined;
      const capture = (channel: 'stdout' | 'stderr', chunk: Buffer) => { if (entry.termination === 'output-limit') return; const remaining = OUTPUT_LIMIT - entry.bytes; if (remaining <= 0 || chunk.byteLength > remaining) { const prefix = remaining > 0 ? chunk.subarray(0, remaining).toString('utf8') : ''; entry[channel] += prefix; entry.bytes += Math.max(0, remaining); signal(entry, 'SIGTERM', 'output-limit'); outputKillTimer = setTimeout(() => signal(entry, 'SIGKILL'), graceMs); outputKillTimer.unref(); return; } entry[channel] += chunk.toString('utf8'); entry.bytes += chunk.byteLength; };
      child.stdout?.on('data', (chunk: Buffer) => capture('stdout', chunk)); child.stderr?.on('data', (chunk: Buffer) => capture('stderr', chunk)); child.once('error', (error) => { entry.error = error.message; }); child.once('close', (code, exitSignal) => { if (outputKillTimer !== undefined) clearTimeout(outputKillTimer); void Effect.runPromise(Deferred.succeed(closed, [code, exitSignal])); }); active.add(entry); return entry; }, catch: (cause) => new OwnedProcessError({ operation: 'spawn', detail: cause instanceof Error ? cause.message : 'could not spawn command' }) }); }); }
export function ownedProcessLayer(options: { readonly graceMs?: number } = {}): Layer.Layer<OwnedProcess> { const graceMs = options.graceMs ?? 500; return Layer.effect(OwnedProcess, Effect.gen(function* () { const active = new Set<Active>(); let stopping: NodeJS.Signals | undefined; yield* Effect.addFinalizer(() => Effect.forEach(active, (entry) => stop(entry, graceMs, 'cancelled').pipe(Effect.asVoid), { discard: true })); return { run: (command, processOptions) => Effect.suspend(() => { if (stopping !== undefined) return Effect.succeed({ command, exitCode: null, signal: stopping, timedOut: false, cancelled: true, outputLimitExceeded: false, stdout: '', stderr: '', processGroupOwned: false, groupCleanup: none('runner cancellation was already requested') }); return Effect.acquireRelease(acquire(command, processOptions, active, graceMs), (entry) => stop(entry, graceMs, 'cancelled').pipe(Effect.asVoid, Effect.ensuring(Effect.sync(() => active.delete(entry))))).pipe(Effect.flatMap((entry) => { const observed = Deferred.await(entry.closed).pipe(Effect.flatMap((close) => makeResult(entry, close, graceMs)), Effect.tap((result) => Deferred.succeed(entry.shutdown, result))); const timed = processOptions.timeoutMs === undefined ? observed : Effect.raceFirst(observed, Effect.sleep(processOptions.timeoutMs).pipe(Effect.andThen(stop(entry, graceMs, 'timeout')))); return timed.pipe(Effect.ensuring(Effect.sync(() => active.delete(entry)))); })); }), requestStop: (name) => Effect.sync(() => { stopping ??= name; for (const entry of active) signal(entry, name, 'cancelled'); }), stop: (name) => Effect.forEach(active, (entry) => stop(entry, graceMs, 'cancelled', name), { discard: true }).pipe(Effect.asVoid), forceKill: Effect.sync(() => { for (const entry of active) signal(entry, 'SIGKILL'); }), activeCount: Effect.sync(() => active.size), awaitIdle: Effect.forEach(active, (entry) => stop(entry, graceMs, 'cancelled'), { discard: true }).pipe(Effect.asVoid) } satisfies OwnedProcessService; })); }
export const OwnedProcessLive = ownedProcessLayer();
