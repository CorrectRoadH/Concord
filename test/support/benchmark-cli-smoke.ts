import { Effect } from 'effect';
import { PerfError, type CliExecutionOptions, type CliExecutor } from '../../scripts/perf/process.ts';
import { benchmarkSmoke } from './benchmark-smoke.ts';
import { runCli } from './cli.ts';

/** These timestamps support shared expectations, not process startup measurements. */
const executeCli: CliExecutor = Effect.fn('test.benchmarkCliExecutor')(function*(argv: readonly string[], options: CliExecutionOptions) {
  let pending: ReturnType<typeof runCli> | undefined;
  return yield* Effect.tryPromise({
    try: async signal => {
      const invocationSignal = options.timeoutMs === undefined ? signal : AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
      const startedAtMs = performance.now();
      pending = runCli({ argv, cwd: options.cwd, env: { ...process.env, ...options.env }, signal: invocationSignal });
      const result = await pending;
      const endedAtMs = performance.now();
      return { ...result, ms: endedAtMs - startedAtMs, startedAtMs, endedAtMs, signal: null };
    },
    catch: cause => new PerfError({ message: `${argv.join(' ')}: ${String(cause)}` }),
  }).pipe(Effect.ensuring(Effect.promise(async () => {
    // Interrupted callers wait for runCli's scope cleanup before fixture finalizers delete sources.
    if (pending !== undefined) await pending.then(() => undefined, () => undefined);
  })));
});

export const benchmarkCliSmoke = (feature: string, indices?: readonly number[]) => benchmarkSmoke(false, feature, indices, executeCli);
