// @concord-file
// @concord-implements docs/engineering/testing/use-case/split-slow-test.md
// @concord-implements docs/engineering/testing/architecture.md#bun-测试引擎
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { Duration, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { summarizeTestLayers } from './test-layers.ts';
import { observeTestProcessTree } from './gate-resource-processes.ts';
import { GateResourcesInvalid } from './gate-resources.ts';
import { readBunCases, readBunCompletion } from './bun-test-report.ts';

class TestRunnerFailed extends Schema.TaggedError<TestRunnerFailed>()('TestRunnerFailed', {
  cause: Schema.Defect(),
}) {}
interface SourceTestOptions {
  readonly files: readonly string[];
  readonly concurrency: number;
  readonly testNamePatterns?: string;
  readonly timeout: number;
}
type Counts = ReturnType<typeof readBunCases>['counts'];

/** The controller owns concurrency and diagnostics; Bun owns test execution and reports. */
export const runNodeTests = Effect.fn('test.bun')(function*(options: SourceTestOptions, output: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const pinned = (yield* fs.readFileString(fileURLToPath(new URL('../.bun-version', import.meta.url)))).trim();
  yield* Effect.scoped(Effect.gen(function*() {
    const child = yield* spawner.spawn(ChildProcess.make('bun', ['--version'], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    const [version, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], { concurrency: 'unbounded' });
    if (Number(code) !== 0 || version.trim() !== pinned) return yield* new TestRunnerFailed({ cause: new Error(`Bun ${pinned} is required; found ${version.trim()}`) });
  }));
  const logs = resolve(output, 'node');
  yield* fs.makeDirectory(logs, { recursive: true });
  const eventDirectory = resolve(process.env.CONCORD_TEST_EVENT_DIRECTORY ?? join(output, 'process-events'));
  const eventRun = process.env.CONCORD_TEST_FILE_ID === undefined ? process.env.CONCORD_TEST_RUN_ID ?? randomUUID() : randomUUID();
  const preload = fileURLToPath(new URL('../test/support/source-runtime.ts', import.meta.url));
  yield* fs.writeFileString(join(output, 'process-event-run.json'), `${JSON.stringify({ run: eventRun, directory: eventDirectory })}\n`);
  const timingsPath = process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl');
  const runCounts: Counts = { tests: 0, failed: 0, cancelled: 0, skipped: 0 };
  let success = true, countsKnown = true, fileProcessStarts = 0;
  let cleanupFailed = false;
  const fileTimings: { file: string; duration_ms: number; success: boolean; cases?: number }[] = [];
  const failure = (file: string, name: string, error: string) => fs.writeFileString(join(output, 'node-failures.jsonl'), `${JSON.stringify({ file, name, error })}\n`, { flag: 'a' });
  const readReport = Effect.fn('test.bun.readReport')(function*(path: string) {
    const stat = yield* fs.stat(path);
    if (Number(stat.size) > 16 * 1024 * 1024) return yield* new TestRunnerFailed({ cause: new Error(`Bun report exceeds 16 MiB: ${path}`) });
    return yield* fs.readFileString(path);
  });
  const engine = (file: string) => Effect.scoped(Effect.gen(function*() {
    // The official engine merges existing timings, so every invocation owns a new destination.
    const directory = yield* fs.makeTempDirectory({ directory: logs, prefix: `${basename(file)}-` });
    const officialTimings = join(directory, 'timings.json'), junit = join(directory, 'junit.xml');
    const config = join(directory, 'bunfig.toml');
    yield* fs.writeFileString(config, '');
    const id = createHash('sha256').update(file).digest('hex');
    const log = join(logs, `${basename(file)}-${id}.log`);
    const observation = yield* observeTestProcessTree(file, []);
    let finished = false;
    const finish = Effect.uninterruptible(Effect.gen(function*() {
      if (finished) return;
      finished = true;
      const report = yield* observation.finish.pipe(Effect.onExit(exit => Effect.sync(() => {
        if (exit._tag === 'Failure') cleanupFailed = true;
      })));
      yield* fs.writeFileString(join(output, 'process-tree-peaks.jsonl'), `${JSON.stringify(report)}\n`, { flag: 'a' });
    }));
    yield* Effect.addFinalizer(() => finish.pipe(Effect.orDie));
    const code = yield* Effect.scoped(Effect.gen(function*() {
      const child = yield* spawner.spawn(ChildProcess.make('bun', [
        'test', '--no-env-file', `--config=${config}`, '--no-install', '--conditions=concord-source', '--preload', preload,
        '--pass-with-no-tests', `--timeout=${options.timeout}`, '--reporter=junit', `--reporter-outfile=${junit}`,
        '--timings', officialTimings, '--update-timings',
        ...(options.testNamePatterns === undefined ? [] : [`--test-name-pattern=${options.testNamePatterns}`]), file,
      ], { env: { ...process.env, NODE_TEST_CONTEXT: undefined,
        CONCORD_TEST_EVENT_DIRECTORY: eventDirectory, CONCORD_TEST_RUN_ID: eventRun, CONCORD_TEST_FILE_ID: file,
        CONCORD_TEST_BUN_FILE_ROOT: '1' },
      detached: process.platform !== 'win32', stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', forceKillAfter: Duration.seconds(5) }));
      yield* observation.register(Number(child.pid), process.platform !== 'win32');
      yield* Effect.addFinalizer(exit => exit._tag === 'Success' ? Effect.void : Effect.gen(function*() {
        // Cancellation must not race the controller's own bounded shutdown grace.
        // Signal the owned group directly, then independently confirm its disappearance.
        if (process.platform === 'win32') yield* child.kill({ killSignal: 'SIGKILL' }).pipe(Effect.ignore);
        else yield* Effect.try({ try: () => { try { process.kill(-Number(child.pid), 'SIGKILL'); } catch (cause) {
          if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) throw cause;
        } }, catch: cause => new TestRunnerFailed({ cause }) }).pipe(Effect.orDie);
        yield* finish;
      }).pipe(Effect.orDie));
      fileProcessStarts++;
      const drain = (stream: typeof child.stdout, target: NodeJS.WriteStream) => Stream.runForEach(Stream.decodeText(stream), text =>
        fs.writeFileString(log, text, { flag: 'a' }).pipe(Effect.andThen(Effect.sync(() => { target.write(text); }))));
      const [, , code] = yield* Effect.all([drain(child.stdout, process.stdout), drain(child.stderr, process.stderr), child.exitCode], { concurrency: 'unbounded' });
      // Let normally draining descendants finish before the spawner scope's kill finalizer.
      // The outer finalizer performs the same group confirmation after timeout/cancellation.
      yield* finish;
      return Number(code);
    })).pipe(
      Effect.timeoutOrElse({ duration: Duration.millis(options.timeout), orElse: () => new TestRunnerFailed({ cause: new Error(`Bun file process deadline exceeded: ${file}`) }) }),
    );
    const duration = yield* readReport(officialTimings).pipe(Effect.flatMap(text => Effect.try({
      try: () => readBunCompletion(text, file, process.cwd()), catch: cause => new TestRunnerFailed({ cause }),
    })));
    const cases = (yield* fs.exists(junit)) ? yield* readReport(junit).pipe(Effect.flatMap(text => Effect.try({
      try: () => readBunCases(text, file, process.cwd()), catch: cause => new TestRunnerFailed({ cause }),
    }))) : Number(code) === 0 ? { counts: { tests: 0, failed: 0, cancelled: 0, skipped: 0 }, failures: [] } : undefined;
    for (const detail of cases?.failures ?? []) yield* failure(file, detail.name, detail.error);
    yield* finish;
    return { duration, counts: cases?.counts, success: Number(code) === 0 && (cases?.counts.failed ?? 0) === 0 };
  }));
  yield* Effect.forEach(options.files, original => Effect.gen(function*() {
    const file = resolve(original);
    const execute = Effect.gen(function*() {
      if (cleanupFailed) return yield* new GateResourcesInvalid({ detail: 'A test process tree could not be released safely' });
      const started = performance.now();
      const result = yield* engine(file).pipe(Effect.catch(cause => Effect.gen(function*() {
        const error = inspect(cause, { depth: 8, maxStringLength: 100_000 });
        yield* failure(file, 'Bun test engine', error);
        yield* Effect.sync(() => console.error(`# Bun test engine failed: ${file}; ${error}`));
        return { duration: performance.now() - started, counts: undefined, success: false };
      })));
      success &&= result.success;
      countsKnown &&= result.counts !== undefined;
      if (result.counts) for (const name of ['tests', 'failed', 'cancelled', 'skipped'] as const) runCounts[name] += result.counts[name];
      const timing = { file, duration_ms: result.duration, success: result.success,
        ...(result.counts === undefined ? {} : { cases: result.counts.tests }) };
      fileTimings.push(timing);
      yield* fs.writeFileString(timingsPath, `${JSON.stringify({ ...timing, scope: 'file', counts: result.counts ?? null })}\n`, { flag: 'a' });
      yield* Effect.sync(() => console.error(`# Bun file: ${file}; ${(timing.duration_ms / 1000).toFixed(3)}s; success=${timing.success}; logs=${logs}`));
    });
    yield* execute;
  }), { concurrency: options.concurrency, discard: true });
  yield* fs.writeFileString(timingsPath, `${JSON.stringify({ scope: 'run', success, counts: countsKnown ? runCounts : null,
    observedCounts: runCounts, countsKnown, fileProcessStarts })}\n`, { flag: 'a' });
  const sorted = fileTimings.sort((left, right) => right.duration_ms - left.duration_ms);
  yield* fs.writeFileString(join(output, 'file-timings.json'), `${JSON.stringify(sorted, null, 2)}\n`);
  const layers = summarizeTestLayers(sorted.map(timing => timing.file), sorted);
  yield* fs.writeFileString(join(output, 'layer-timings.json'), `${JSON.stringify(layers, null, 2)}\n`);
  for (const layer of layers) yield* Effect.sync(() => console.error(`# Bun layer ${layer.layer}: files=${layer.files}; cases=${layer.cases}; countedFiles=${layer.countedFiles}; ${(layer.duration_ms / 1000).toFixed(3)}s (sum of file durations)`));
  return !success;
});
