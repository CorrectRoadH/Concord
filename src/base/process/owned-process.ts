// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#执行管线
// Scope-owned, detached process groups for repository commands.
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { Cause, Context, Deferred, Effect, Fiber, Layer, Option, Queue, Result, Scope, Stream } from "effect";
import { NodeServices } from '@effect/platform-node';
import { ChildProcess as ProcessCommand, ChildProcessSpawner } from 'effect/unstable/process';
import type { ChildProcessHandle } from 'effect/unstable/process/ChildProcessSpawner';
import { resolveTrustedExecutable } from './trusted-executable.js';
import { OwnedProcessError } from './owned-process-error.js';
export { OwnedProcessError } from './owned-process-error.js';

const captureEnvironment = () => Object.freeze({ env: Object.freeze({ ...process.env }), cwd: process.cwd() });

const OUTPUT_LIMIT = 4 * 1024 * 1024;
export type OwnedTermination = 'timeout' | 'cancelled' | 'output-limit';
export interface OwnedProcessOptions { readonly stdin?: string; readonly stream?: { readonly ready: (write: (bytes: string) => void, end: () => void, identity: { readonly pid: number | undefined; readonly groupId: number | undefined }) => void; readonly stdout: (chunk: Buffer) => void }; readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number; readonly outputLimitBytes?: number; readonly stdoutLimitBytes?: number; readonly stderrLimitBytes?: number; readonly ipc?: { readonly ready: (send: (message: unknown) => Promise<void>) => void; readonly message: (message: unknown) => void }; }
export interface OwnedProcessGroupCleanup { readonly owned: boolean; readonly checked: boolean; readonly aliveAfterLeaderClose: boolean | null; readonly groupId?: number; readonly signalsSent: readonly NodeJS.Signals[]; readonly gone: boolean | null; readonly detail: string; }
export interface OwnedProcessResult {
  readonly command: readonly string[]; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean; readonly cancelled: boolean; readonly outputLimitExceeded: boolean;
  readonly stdout: string; readonly stderr: string; readonly outputBytes: number; readonly error?: string; readonly processGroupOwned: boolean; readonly groupCleanup: OwnedProcessGroupCleanup;
}
export interface OwnedProcessService {
  readonly environment: ReturnType<typeof captureEnvironment>;
  readonly resolveExecutable: typeof resolveTrustedExecutable;
  readonly run: (command: readonly string[], options: OwnedProcessOptions) => Effect.Effect<OwnedProcessResult, OwnedProcessError, Scope.Scope>;
  readonly requestStop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly stop: (signal: NodeJS.Signals) => Effect.Effect<void>;
  readonly forceKill: Effect.Effect<void>; readonly activeCount: Effect.Effect<number>; readonly awaitIdle: Effect.Effect<void>;
  readonly cleanupResults: Effect.Effect<readonly OwnedProcessResult[]>;
}
export class OwnedProcess extends Context.Service<OwnedProcess, OwnedProcessService>()('concord/OwnedProcess') {}
export const runOwnedProcess = (command: readonly string[], options: OwnedProcessOptions) => Effect.flatMap(OwnedProcess, (service) => service.run(command, options));
export const hasConfirmedOwnedGroupCleanup = (result: Pick<OwnedProcessResult, 'processGroupOwned' | 'groupCleanup'>): boolean => !result.processGroupOwned || result.groupCleanup.gone === true;
export const hasSuccessfulOwnedProcessResult = (result: Pick<OwnedProcessResult, 'exitCode' | 'signal' | 'timedOut' | 'cancelled' | 'outputLimitExceeded' | 'error' | 'processGroupOwned' | 'groupCleanup'>): boolean => result.exitCode === 0 && result.signal === null && !result.timedOut && !result.cancelled && !result.outputLimitExceeded && result.error === undefined && hasConfirmedOwnedGroupCleanup(result);

export type GroupPresence = 'alive' | 'zombie-only' | 'gone' | 'unknown';
export interface GroupPresenceDependencies {
  readonly platform?: NodeJS.Platform;
  readonly kill?: (pid: number, signal: 0) => void;
  readonly procEntries?: () => readonly string[];
  readonly procStat?: (pid: string) => string;
}
export function observeOwnedProcessGroup(groupId: number, dependencies: GroupPresenceDependencies = {}): GroupPresence {
  const platform = dependencies.platform ?? process.platform;
  const kill = dependencies.kill ?? ((pid: number, signal: 0) => process.kill(pid, signal));
  try {
    kill(-groupId, 0);
    if (platform === 'linux') {
      const entries = dependencies.procEntries?.() ?? readdirSync('/proc', { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name)).map((entry) => entry.name);
      const states: boolean[] = [];
      let incomplete = false;
      for (const pid of entries) {
        try {
          const stat = dependencies.procStat?.(pid) ?? readFileSync(`/proc/${pid}/stat`, 'utf8');
          const fields = stat.slice(stat.lastIndexOf(')') + 1).trimStart().split(/\s+/u);
          if (Number(fields[2]) === groupId) states.push(fields[0] === 'Z' || fields[0] === 'X');
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') incomplete = true;
        }
      }
      if (incomplete) return 'unknown';
      if (states.length > 0 && states.every(Boolean)) return 'zombie-only';
    }
    return 'alive';
  } catch (cause) { return (cause as NodeJS.ErrnoException).code === 'ESRCH' ? 'gone' : 'unknown'; }
}
interface Active { groupPresence?: GroupPresenceDependencies; readonly child?: ChildProcess; readonly handle?: ChildProcessHandle; readonly limitReached?: Deferred.Deferred<void>; readonly command: readonly string[]; readonly groupOwned: boolean; readonly groupId?: number; readonly signals: NodeJS.Signals[]; readonly closed: Deferred.Deferred<readonly [number | null, NodeJS.Signals | null]>; readonly shutdown: Deferred.Deferred<OwnedProcessResult>; readonly stdoutDecoder: StringDecoder; readonly stderrDecoder: StringDecoder; stdout: string; stderr: string; bytes: number; decoded: boolean; error?: string; termination?: OwnedTermination; }
const none = (detail: string): OwnedProcessGroupCleanup => ({ owned: false, checked: false, aliveAfterLeaderClose: null, signalsSent: [], gone: null, detail });
function signal(active: Active, name: NodeJS.Signals, reason?: OwnedTermination): void {
  if (reason !== undefined && active.termination === undefined) active.termination = reason;
  if (active.handle !== undefined) {
    active.signals.push(name);
    void Effect.runPromise(active.handle.kill({ killSignal: name, forceKillAfter: 500 }).pipe(Effect.ignore));
    return;
  }
  // Node IPC is not provided by the pinned ChildProcess API.
  try { if (active.groupOwned && active.groupId !== undefined) { process.kill(-active.groupId, name); active.signals.push(name); } else active.child?.kill(name); } catch { /* already closed */ }
}
function waitGroup(groupId: number, remaining: number, dependencies?: GroupPresenceDependencies): Effect.Effect<GroupPresence> { return Effect.suspend(() => { const state = observeOwnedProcessGroup(groupId, dependencies); return state === 'alive' && remaining > 0 ? Effect.sleep(Math.min(100, remaining)).pipe(Effect.andThen(waitGroup(groupId, remaining - 100, dependencies))) : Effect.succeed(state); }); }
function cleanup(active: Active, graceMs: number): Effect.Effect<OwnedProcessGroupCleanup> {
  if (!active.groupOwned || active.groupId === undefined) return Effect.succeed(none('no detached POSIX process group was created'));
  const initial = observeOwnedProcessGroup(active.groupId, active.groupPresence); const result = (state: GroupPresence, detail: string): OwnedProcessGroupCleanup => ({ owned: true, checked: true, aliveAfterLeaderClose: initial === 'alive', groupId: active.groupId, signalsSent: active.signals, gone: state === 'gone' || state === 'zombie-only', detail });
  if (initial !== 'alive') return Effect.succeed(result(initial, initial === 'unknown' ? 'could not verify owned process group' : 'owned process group has no running members'));
  return Effect.sync(() => signal(active, 'SIGTERM')).pipe(Effect.andThen(waitGroup(active.groupId, graceMs, active.groupPresence)), Effect.flatMap((afterTerm) => afterTerm === 'alive' ? Effect.sync(() => signal(active, 'SIGKILL')).pipe(Effect.andThen(waitGroup(active.groupId!, graceMs, active.groupPresence)), Effect.map((afterKill) => result(afterKill, 'owned process group required TERM/grace/KILL cleanup'))) : Effect.succeed(result(afterTerm, 'owned process group drained after TERM grace'))));
}
function makeResult(active: Active, close: readonly [number | null, NodeJS.Signals | null], graceMs: number): Effect.Effect<OwnedProcessResult> { return cleanup(active, graceMs).pipe(Effect.map((groupCleanup) => { if (!active.decoded) { active.stdout += active.stdoutDecoder.end(); active.stderr += active.stderrDecoder.end(); active.decoded = true; } return { command: active.command, exitCode: close[0], signal: close[1], timedOut: active.termination === 'timeout', cancelled: active.termination === 'cancelled', outputLimitExceeded: active.termination === 'output-limit', stdout: active.stdout, stderr: active.stderr, outputBytes: active.bytes, ...(active.error === undefined ? {} : { error: active.error }), processGroupOwned: active.groupOwned && active.groupId !== undefined, groupCleanup }; })); }
function stop(active: Active, graceMs: number, reason: OwnedTermination, first: NodeJS.Signals = 'SIGTERM'): Effect.Effect<OwnedProcessResult> { return Effect.uninterruptible(Effect.gen(function* () {
  const known = yield* Deferred.poll(active.shutdown);
  if (Option.isSome(known)) return yield* known.value;
  signal(active, first, reason);
  const closed = yield* Deferred.await(active.closed).pipe(Effect.timeoutOption(graceMs));
  if (Option.isNone(closed)) {
    signal(active, 'SIGKILL');
    const killed = yield* Deferred.await(active.closed).pipe(Effect.timeoutOption(graceMs));
    if (Option.isNone(killed)) {
      const observed = yield* makeResult(active, [null, 'SIGKILL'], graceMs);
      const result: OwnedProcessResult = { ...observed, error: observed.error ?? `process did not close within ${graceMs}ms after SIGKILL` };
      yield* Deferred.succeed(active.shutdown, result);
      return result;
    }
    const result = yield* makeResult(active, killed.value, graceMs);
    yield* Deferred.succeed(active.shutdown, result);
    return result;
  }
  const result = yield* makeResult(active, closed.value, graceMs);
  yield* Deferred.succeed(active.shutdown, result);
  return result;
})); }
function acquireIpc(command: readonly string[], options: OwnedProcessOptions, active: Set<Active>, graceMs: number): Effect.Effect<Active, OwnedProcessError> { return Effect.gen(function* () { const closed = yield* Deferred.make<readonly [number | null, NodeJS.Signals | null]>(); const shutdown = yield* Deferred.make<OwnedProcessResult>(); return yield* Effect.try({ try: () => { if (command[0] === undefined) throw new Error('owned process command must contain an executable'); const limit = options.outputLimitBytes ?? OUTPUT_LIMIT; if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid owned process output limit'); for (const channelLimit of [options.stdoutLimitBytes, options.stderrLimitBytes]) if (channelLimit !== undefined && (!Number.isSafeInteger(channelLimit) || channelLimit < 1)) throw new Error('invalid owned process channel output limit'); const groupOwned = process.platform !== 'win32'; const env = { ...(options.env ?? process.env) }; delete env.NODE_TEST_CONTEXT; const child = spawn(command[0], command.slice(1), { cwd: options.cwd, env, detached: groupOwned, stdio: options.ipc ? [options.stdin === undefined && options.stream === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe', 'ipc'] : [options.stdin === undefined && options.stream === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] }); const entry: Active = { child, command, groupOwned, ...(groupOwned && child.pid !== undefined && child.pid !== process.pid ? { groupId: child.pid } : {}), signals: [], closed, shutdown, stdoutDecoder: new StringDecoder('utf8'), stderrDecoder: new StringDecoder('utf8'), stdout: '', stderr: '', bytes: 0, decoded: false };
      const channelBytes = { stdout: 0, stderr: 0 };
      const capture = (channel: 'stdout' | 'stderr', chunk: Buffer) => { if (entry.termination === 'output-limit') return; const channelLimit = (channel === 'stdout' ? options.stdoutLimitBytes : options.stderrLimitBytes) ?? limit; const remaining = Math.min(limit - entry.bytes, channelLimit - channelBytes[channel]); const kept = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0); entry[channel] += (channel === 'stdout' ? entry.stdoutDecoder : entry.stderrDecoder).write(kept); entry.bytes += kept.byteLength; channelBytes[channel] += kept.byteLength; if (channel === 'stdout') options.stream?.stdout(kept); if (chunk.byteLength > remaining) { entry.termination = 'output-limit'; void Effect.runPromise(stop(entry, graceMs, 'output-limit')); } };
      child.stdout?.on('data', (chunk: Buffer) => capture('stdout', chunk)); child.stderr?.on('data', (chunk: Buffer) => capture('stderr', chunk)); child.once('error', (error) => { entry.error = error.message; }); child.once('close', (code, exitSignal) => { void Effect.runPromise(Deferred.succeed(closed, [code, exitSignal])); }); active.add(entry); if (options.stream !== undefined) { child.stdin?.on('error', () => { /* Classified by the process result. */ }); child.once('spawn', () => options.stream!.ready(bytes => { child.stdin?.write(bytes); }, () => { child.stdin?.end(); }, { pid: child.pid, groupId: entry.groupId })); } if (options.stdin !== undefined) { child.stdin?.on('error', () => { /* EPIPE is classified through the process result. */ }); child.stdin?.end(options.stdin, 'utf8'); } if (options.ipc) { child.on('message', options.ipc.message); child.once('spawn', () => options.ipc!.ready(message => new Promise<void>((resolve, reject) => { child.send!(message as Parameters<NonNullable<ChildProcess['send']>>[0], error => error ? reject(error) : resolve()); }))); } return entry; }, catch: (cause) => new OwnedProcessError({ operation: 'spawn', detail: cause instanceof Error ? cause.message : 'could not spawn command' }) }); }); }
let standaloneSpawner: ChildProcessSpawner.ChildProcessSpawner['Service'] | undefined;
/** Standalone Node factory for callers with their own owner scope. Layers inject the platform. */
function nodeSpawner(): ChildProcessSpawner.ChildProcessSpawner['Service'] {
  return standaloneSpawner ??= Effect.runSync(ChildProcessSpawner.ChildProcessSpawner.pipe(Effect.provide(NodeServices.layer)));
}

const acquire = Effect.fn('OwnedProcess.acquire')(function*(command: readonly string[], options: OwnedProcessOptions, active: Set<Active>, graceMs: number, spawner: ChildProcessSpawner.ChildProcessSpawner['Service']) {
  if (options.ipc !== undefined) return yield* acquireIpc(command, options, active, graceMs);
  const executable = command[0];
  const limit = options.outputLimitBytes ?? OUTPUT_LIMIT;
  if (executable === undefined || !Number.isSafeInteger(limit) || limit < 1 || [options.stdoutLimitBytes, options.stderrLimitBytes].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 1))) {
    return yield* Effect.fail(new OwnedProcessError({ operation: 'spawn', detail: executable === undefined ? 'owned process command must contain an executable' : 'invalid owned process output limit' }));
  }
  const closed = yield* Deferred.make<readonly [number | null, NodeJS.Signals | null]>();
  const shutdown = yield* Deferred.make<OwnedProcessResult>();
  const limitReached = yield* Deferred.make<void>();
  const groupOwned = process.platform !== 'win32';
  const env = { ...(options.env ?? process.env) };
  delete env.NODE_TEST_CONTEXT;
  const spawned = yield* Effect.result(spawner.spawn(ProcessCommand.make(executable, command.slice(1), {
    cwd: options.cwd, env, detached: groupOwned, forceKillAfter: graceMs,
    stdin: options.stdin === undefined && options.stream === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe',
  })));
  const entry: Active = {
    command, groupOwned, signals: [], closed, shutdown, limitReached,
    stdoutDecoder: new StringDecoder('utf8'), stderrDecoder: new StringDecoder('utf8'), stdout: '', stderr: '', bytes: 0, decoded: false,
    ...(Result.isSuccess(spawned) ? { handle: spawned.success, ...(groupOwned ? { groupId: Number(spawned.success.pid) } : {}) } : { error: spawned.failure.message }),
  };
  active.add(entry);
  if (Result.isFailure(spawned)) {
    yield* Deferred.succeed(closed, [null, null]);
    return entry;
  }
  const child = spawned.success;
  const channelBytes = { stdout: 0, stderr: 0 };
  const capture = (channel: 'stdout' | 'stderr', raw: Uint8Array): void => {
    if (entry.termination === 'output-limit') return;
    const chunk = Buffer.from(raw);
    const channelLimit = (channel === 'stdout' ? options.stdoutLimitBytes : options.stderrLimitBytes) ?? limit;
    const remaining = Math.min(limit - entry.bytes, channelLimit - channelBytes[channel]);
    const kept = remaining > 0 ? chunk.subarray(0, remaining) : Buffer.alloc(0);
    entry[channel] += (channel === 'stdout' ? entry.stdoutDecoder : entry.stderrDecoder).write(kept);
    entry.bytes += kept.byteLength;
    channelBytes[channel] += kept.byteLength;
    if (channel === 'stdout') options.stream?.stdout(kept);
    if (chunk.byteLength > remaining) { entry.termination = 'output-limit'; Deferred.doneUnsafe(limitReached, Effect.void); }
  };
  const drain = (channel: 'stdout' | 'stderr') => Stream.runForEach(child[channel], chunk => Effect.sync(() => capture(channel, chunk))).pipe(
    Effect.catch(cause => Effect.sync(() => { entry.error ??= cause.message; })),
  );
  const stdout = yield* Effect.forkScoped(drain('stdout'));
  const stderr = yield* Effect.forkScoped(drain('stderr'));
  const input = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  if (options.stdin !== undefined || options.stream !== undefined) {
    yield* Effect.forkScoped(Stream.run(Stream.fromQueue(input), child.stdin).pipe(Effect.ignore));
    if (options.stdin !== undefined) { Queue.offerUnsafe(input, Buffer.from(options.stdin)); Queue.endUnsafe(input); }
  }
  options.stream?.ready(bytes => { Queue.offerUnsafe(input, Buffer.from(bytes)); }, () => { Queue.endUnsafe(input); }, { pid: Number(child.pid), groupId: entry.groupId });
  yield* Effect.forkScoped(Effect.gen(function*() {
    const status = yield* Effect.result(child.exitCode);
    yield* Fiber.join(stdout);
    yield* Fiber.join(stderr);
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    if (Result.isSuccess(status)) exitCode = Number(status.success);
    else {
      const signalName = /receipt of signal: '(SIG[A-Z0-9]+)'/u.exec(status.failure.message)?.[1];
      if (signalName !== undefined) exitSignal = signalName as NodeJS.Signals;
      else entry.error ??= status.failure.message;
    }
    yield* Deferred.succeed(closed, [exitCode, exitSignal]);
  }));
  return entry;
});

export function makeOwnedProcessService(options: { readonly graceMs?: number; readonly groupPresence?: GroupPresenceDependencies; readonly spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"] } = {}): OwnedProcessService {
  const environment = captureEnvironment();
  const graceMs = options.graceMs ?? 500;
  const active = new Set<Active>();
  const completed: OwnedProcessResult[] = [];
  const recorded = new WeakSet<Active>();
  let stopping: NodeJS.Signals | undefined;
  let isolated = false;
  const record = (entry: Active, result: OwnedProcessResult): Effect.Effect<OwnedProcessResult> => Effect.sync(() => {
    if (!recorded.has(entry)) { completed.push(result); recorded.add(entry); }
    if (!hasConfirmedOwnedGroupCleanup(result)) isolated = true;
    return result;
  });
  return {
    environment,
    resolveExecutable: resolveTrustedExecutable,
    run: (command, processOptions) => Effect.suspend(() => {
      if (isolated) return Effect.fail(new OwnedProcessError({ operation: 'observe', detail: 'Owned process cleanup is unconfirmed; this owner is isolated' }));
      if (stopping !== undefined) {
        return Effect.succeed({ command, exitCode: null, signal: stopping, timedOut: false, cancelled: true, outputLimitExceeded: false, stdout: '', stderr: '', outputBytes: 0, processGroupOwned: false, groupCleanup: none('runner cancellation was already requested') });
      }
      return Effect.acquireRelease(
        acquire(command, processOptions, active, graceMs, options.spawner ?? nodeSpawner()).pipe(Effect.tap(entry => Effect.sync(() => {
          entry.groupPresence = options.groupPresence;
          // Cancellation may arrive while the platform is waiting for the spawn event.
          if (stopping !== undefined) signal(entry, stopping, 'cancelled');
        }))),
        (entry) => stop(entry, graceMs, 'cancelled').pipe(Effect.flatMap((result) => record(entry, result)), Effect.asVoid, Effect.ensuring(Effect.sync(() => active.delete(entry)))),
      ).pipe(Effect.flatMap((entry) => {
        const observedClose = Deferred.await(entry.closed).pipe(
          Effect.flatMap((close) => makeResult(entry, close, graceMs)),
          Effect.tap((result) => Deferred.succeed(entry.shutdown, result)),
        );
        const observed = Effect.raceFirst(observedClose, Deferred.await(entry.shutdown));
        const bounded = entry.limitReached === undefined ? observed : Effect.raceFirst(observed, Deferred.await(entry.limitReached).pipe(Effect.andThen(stop(entry, graceMs, 'output-limit'))));
        const timed = processOptions.timeoutMs === undefined
          ? bounded
          : Effect.raceFirst(bounded, Effect.sleep(processOptions.timeoutMs).pipe(Effect.andThen(stop(entry, graceMs, 'timeout'))));
        return timed.pipe(Effect.flatMap((result) => record(entry, result)), Effect.ensuring(Effect.sync(() => active.delete(entry))));
      }));
    }),
    requestStop: (name) => Effect.sync(() => { stopping ??= name; for (const entry of active) signal(entry, name, 'cancelled'); }),
    stop: (name) => Effect.forEach(active, (entry) => stop(entry, graceMs, 'cancelled', name), { discard: true }).pipe(Effect.asVoid),
    forceKill: Effect.sync(() => { for (const entry of active) signal(entry, 'SIGKILL'); }),
    activeCount: Effect.sync(() => active.size),
    awaitIdle: Effect.forEach(active, (entry) => stop(entry, graceMs, 'cancelled'), { discard: true }).pipe(Effect.asVoid),
    cleanupResults: Effect.sync(() => [...completed]),
  };
}

export function ownedProcessLayer(options: { readonly graceMs?: number } = {}): Layer.Layer<OwnedProcess, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Layer.effect(OwnedProcess, Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const service = makeOwnedProcessService({ ...options, spawner });
    yield* Effect.addFinalizer(() => service.awaitIdle);
    return service;
  }));
}
export const OwnedProcessLive = ownedProcessLayer().pipe(Layer.provide(NodeServices.layer));
