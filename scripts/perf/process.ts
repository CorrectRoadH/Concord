import { spawn, execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';

export class PerfError extends Schema.TaggedError<PerfError>()('PerfError', { message: Schema.String }) {}

export const io = <A>(message: string, thunk: () => A): Effect.Effect<A, PerfError> =>
  Effect.try({ try: thunk, catch: cause => new PerfError({ message: `${message}: ${String(cause)}` }) });

export interface TimedRun {
  readonly ms: number; readonly exitCode: number | null; readonly signal: string | null;
  readonly stdout: string; readonly stderr: string;
}
let sequence = 0;

/** Redirect directly to file descriptors; output reading is outside the timed interval. */
export const timedRun = Effect.fn('perf.timedRun')(function*(argv: readonly string[], options: {
  readonly cwd: string; readonly outputDir: string; readonly env?: Record<string, string>; readonly timeoutMs?: number; readonly processGroup?: boolean;
}) {
  if (argv.length === 0) return yield* new PerfError({ message: 'Empty process argv' });
  const id = String(++sequence).padStart(4, '0');
  const stdoutPath = join(options.outputDir, `${id}.stdout`), stderrPath = join(options.outputDir, `${id}.stderr`);
  const out = yield* Effect.acquireRelease(io('Open stdout', () => openSync(stdoutPath, 'w')), fd => Effect.sync(() => closeSync(fd)));
  const err = yield* Effect.acquireRelease(io('Open stderr', () => openSync(stderrPath, 'w')), fd => Effect.sync(() => closeSync(fd)));
  const result = yield* Effect.callback<{ ms: number; exitCode: number | null; signal: string | null }, PerfError>(resume => {
    const started = performance.now();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0]!, argv.slice(1), {
        cwd: options.cwd, stdio: ['ignore', out, err], env: { ...process.env, ...options.env }, detached: options.processGroup ?? false,
        ...(options.timeoutMs === undefined ? {} : { timeout: Math.ceil(options.timeoutMs), killSignal: 'SIGKILL' as const }),
      });
    } catch (cause) {
      resume(Effect.fail(new PerfError({ message: `Spawn ${argv[0]}: ${String(cause)}` })));
      return;
    }
    child.once('error', cause => resume(Effect.fail(new PerfError({ message: `${argv[0]}: ${cause.message}` }))));
    child.once('exit', (exitCode, signal) => resume(Effect.succeed({ ms: performance.now() - started, exitCode, signal })));
    // Scope interruption must not leave a foreground process running.
    return Effect.sync(() => {
      if (options.processGroup && child.pid !== undefined) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
      } else if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
  });
  const output = yield* io('Read process output', () => ({ stdout: readFileSync(stdoutPath, 'utf8'), stderr: readFileSync(stderrPath, 'utf8') }));
  return { ...result, ...output } satisfies TimedRun;
}, Effect.scoped);

export const mustRun = Effect.fn('perf.mustRun')(function*(argv: readonly string[], options: {
  readonly cwd: string; readonly outputDir: string; readonly env?: Record<string, string>;
}) {
  const run = yield* timedRun(argv, options);
  if (run.exitCode !== 0) return yield* new PerfError({ message: `${argv.join(' ')} exited ${run.exitCode ?? run.signal}: ${(run.stderr || run.stdout).slice(0, 2000)}` });
  return run;
});

/** Identify only public CLI refresh children belonging to this exact consumer root. */
export const refreshPids = (root: string) => io('List refresh processes', () => {
  const lines = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  return lines.filter(line => line.includes(`/query-refresh-worker.js ${root} `))
    .map(line => Number(line.trim().split(/\s/u)[0])).filter(pid => Number.isSafeInteger(pid) && pid > 0);
});

/** Let owned detached refreshes publish and exit before deleting the frozen consumer. */
export const settleRefreshes = Effect.fn('perf.settleRefreshes')(function*(root: string, preexisting: readonly number[] = []) {
  const started = performance.now();
  for (;;) {
    const pids = (yield* refreshPids(root)).filter(pid => !preexisting.includes(pid));
    if (pids.length === 0) return;
    if (performance.now() - started > 150_000) {
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
      return;
    }
    yield* Effect.sleep('250 millis');
  }
});
