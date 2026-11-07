import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

export class PerfError extends Schema.TaggedError<PerfError>()('PerfError', { message: Schema.String }) {}

export const io = <A>(message: string, thunk: () => A): Effect.Effect<A, PerfError> =>
  Effect.try({ try: thunk, catch: cause => new PerfError({ message: `${message}: ${String(cause)}` }) });

export interface TimedRun {
  readonly ms: number; readonly startedAtMs: number; readonly endedAtMs: number; readonly exitCode: number | null; readonly signal: string | null;
  readonly stdout: string; readonly stderr: string;
}
export interface CliExecutionOptions {
  readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number;
}
/** A caller may supply CLI execution without changing the default process measurements. */
export type CliExecutor = (argv: readonly string[], options: CliExecutionOptions) => Effect.Effect<TimedRun, PerfError, FileSystem.FileSystem>;

/** Setup and cleanup retain mustRun's success requirement when execution is injected. */
export const mustRunCli = Effect.fn('perf.mustRunCli')(function*(argv: readonly string[], options: CliExecutionOptions, execute: CliExecutor) {
  const run = yield* execute(argv, options);
  if (run.exitCode !== 0) return yield* new PerfError({ message: `${argv.join(' ')} exited ${run.exitCode}: ${(run.stderr || run.stdout).slice(0, 2000)}` });
  return run;
});
let sequence = 0;

/**
 * rc.112 ChildProcess.CommandOutput accepts a pipe or Sink, not a numeric fd.
 * A Sink adds parent-side piping to the measured process. Keep only spawn and
 * fd ownership here so the clock remains immediately-before-spawn to exit.
 */
export const timedRun = Effect.fn('perf.timedRun')(function*(argv: readonly string[], options: {
  readonly cwd: string; readonly outputDir: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number; readonly processGroup?: boolean;
}) {
  if (argv.length === 0) return yield* new PerfError({ message: 'Empty process argv' });
  const id = String(++sequence).padStart(4, '0');
  const stdoutPath = join(options.outputDir, `${id}.stdout`), stderrPath = join(options.outputDir, `${id}.stderr`);
  const out = yield* Effect.acquireRelease(io('Open stdout', () => openSync(stdoutPath, 'w')), fd => Effect.sync(() => closeSync(fd)));
  const err = yield* Effect.acquireRelease(io('Open stderr', () => openSync(stderrPath, 'w')), fd => Effect.sync(() => closeSync(fd)));
  const owned = yield* Effect.acquireRelease(io('Spawn measured process', () => {
    const startedAtMs = performance.now();
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd, stdio: ['ignore', out, err], env: { ...process.env, ...options.env }, detached: options.processGroup ?? false,
    });
    const exited = new Promise<Omit<TimedRun, 'stdout' | 'stderr'>>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => {
        const endedAtMs = performance.now();
        resolve({ ms: endedAtMs - startedAtMs, startedAtMs, endedAtMs, exitCode, signal });
      });
    });
    return { child, exited };
  }), ({ child, exited }) => Effect.gen(function*() {
    // Scope interruption waits for exit before closing the inherited descriptors.
    yield* io('Stop measured process', () => {
      if (child.exitCode === null && child.signalCode === null) {
        if (options.processGroup && child.pid !== undefined) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
        } else child.kill('SIGKILL');
      }
    }).pipe(Effect.orDie);
    yield* Effect.promise(() => exited.then(() => undefined, () => undefined));
  }));
  const wait = Effect.tryPromise({ try: () => owned.exited, catch: cause => new PerfError({ message: `${argv[0]}: ${String(cause)}` }) });
  const result = yield* wait.pipe(Effect.timeoutOrElse({
    duration: options.timeoutMs ?? Infinity,
    // Keep a timeout as an observed SIGKILL exit, preserving sample diagnostics.
    orElse: () => io('Stop timed out sample', () => { owned.child.kill('SIGKILL'); }).pipe(Effect.andThen(wait)),
  }));
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Effect.all({ stdout: fs.readFileString(stdoutPath), stderr: fs.readFileString(stderrPath) }).pipe(
    Effect.mapError(cause => new PerfError({ message: `Read process output: ${String(cause)}` })),
  );
  return { ...result, ...output } satisfies TimedRun;
}, Effect.scoped);

export const mustRun = Effect.fn('perf.mustRun')(function*(argv: readonly string[], options: {
  readonly cwd: string; readonly outputDir: string; readonly env?: NodeJS.ProcessEnv; readonly timeoutMs?: number;
}) {
  if (argv.length === 0) return yield* new PerfError({ message: 'Empty process argv' });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const run = yield* Effect.scoped(Effect.gen(function*() {
    const child = yield* spawner.spawn(ChildProcess.make(argv[0]!, argv.slice(1), {
      cwd: options.cwd, env: options.env, extendEnv: true, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      killSignal: 'SIGKILL',
    }));
    return yield* Effect.all({ exitCode: child.exitCode, stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)) }, { concurrency: 'unbounded' });
  }).pipe(Effect.timeout(options.timeoutMs ?? Infinity))).pipe(
    Effect.mapError(cause => new PerfError({ message: `${argv.join(' ')}: ${String(cause)}` })),
  );
  if (run.exitCode !== 0) return yield* new PerfError({ message: `${argv.join(' ')} exited ${run.exitCode}: ${(run.stderr || run.stdout).slice(0, 2000)}` });
  return run;
});

/** Match invocation positions, never a role or root mentioned inside another argument. */
export function isRefreshArguments(argv: readonly string[], root: string): boolean {
  let entry = 1;
  while (['--no-env-file', '--config=/dev/null', '--conditions=concord-source'].includes(argv[entry] ?? '')) entry++;
  return argv[entry] === '--concord-internal'
    ? argv[entry + 1] === 'query-refresh-worker' && argv[entry + 2] === root
    : /[/\\]query-refresh-worker\.(?:ts|js)$/u.test(argv[entry] ?? '') && argv[entry + 1] === root;
}

const RefreshQuery = Schema.fromJsonString(Schema.Array(Schema.String));
/** A flattened ps line must still contain one complete root followed by the request. */
export function isRefreshCommand(command: string, root: string): boolean {
  const marker = ` ${root} `, start = command.indexOf(marker);
  if (start < 0) return false;
  const prefix = command.slice(0, start);
  // ps does not quote paths. Match complete entry boundaries rather than splitting paths.
  if (/(?:^|\s)(?:-e|--eval|-p|--print|-c|--command)(?:\s|=|$)/u.test(prefix)) return false;
  const internal = ' --concord-internal query-refresh-worker';
  if (prefix.endsWith(internal)) {
    const executable = prefix.slice(0, -internal.length);
    if (!isAbsolute(executable) || basename(executable) !== 'concord') return false;
  } else {
    const source = /^(.+[/\\](?:bun|node)(?:\.exe)?) ((?:(?:--no-env-file|--config=\/dev\/null|--conditions=concord-source) )*)(.+[/\\]query-refresh-worker\.(?:ts|js))$/u.exec(prefix);
    if (!source || !isAbsolute(source[1]!) || !isAbsolute(source[3]!)) return false;
  }
  const request = /^(\[.*\]) \d+(?: \d+)?$/u.exec(command.slice(start + marker.length));
  return request !== null && Schema.decodeUnknownExit(RefreshQuery)(request[1])._tag === 'Success';
}

/** Identify only refresh children belonging to this exact consumer root. */
export const refreshPids = Effect.fn('perf.refreshPids')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const { stdout } = yield* mustRun(['ps', '-ww', '-axo', 'pid=,command='], { cwd: process.cwd(), outputDir: '' });
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
    if (!match || !match[2]!.includes('query-refresh-worker')) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    if (process.platform === 'linux') {
      // ps flattens argument boundaries, including roots containing whitespace.
      const bytes = yield* Effect.result(fs.readFileString(`/proc/${pid}/cmdline`));
      if (bytes._tag === 'Success' && isRefreshArguments(bytes.success.split('\0'), root)) pids.push(pid);
    } else {
      // The request tail disambiguates whitespace in a root from another argument.
      if (isRefreshCommand(match[2]!, root)) pids.push(pid);
    }
  }
  return pids;
});

/** Let owned detached refreshes publish and exit before deleting the frozen consumer. */
export const settleRefreshes = Effect.fn('perf.settleRefreshes')(function*(root: string, preexisting: readonly number[] = [], timeoutMs = 150_000) {
  const settled = yield* Effect.gen(function*() {
    for (;;) {
      const pids = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
      if (pids.length === 0) return;
      yield* Effect.sleep('250 millis');
    }
  }).pipe(Effect.timeoutOption(timeoutMs));
  if (settled._tag === 'None') {
    const pids = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
    yield* io('Stop owned refresh processes', () => {
      for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } }
    });
    yield* Effect.sleep('1 second');
    const remaining = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
    yield* io('Kill owned refresh processes', () => {
      for (const pid of remaining) { try { process.kill(pid, 'SIGKILL'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; } }
    });
    yield* Effect.sleep('100 millis');
    if ((yield* refreshPids(root)).some(pid => !preexisting.includes(pid))) return yield* new PerfError({ message: `Refresh cleanup unconfirmed for ${root}` });
  }
});
