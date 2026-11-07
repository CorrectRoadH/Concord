// @concord-file
// @concord-implements docs/engineering/testing/use-case/split-slow-test.md
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { run, type RunOptions } from 'node:test';
import { tap } from 'node:test/reporters';
import { createHash, randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { summarizeTestLayers } from './test-layers.ts';
import { observeTestProcessTree } from './gate-resource-processes.ts';
import { withGateAdmission, type GateAdmission, type GateResourcesInvalid } from './gate-resources.ts';

type TestEvent = Parameters<typeof tap>[0] extends AsyncIterable<infer Event> ? Event : never;
class TestRunnerFailed extends Schema.TaggedError<TestRunnerFailed>()('TestRunnerFailed', {
  cause: Schema.Defect(),
}) {}

/** Keep project diagnostics beside the unmodified official reporter stream. */
export const runNodeTests = Effect.fn('test.node')(function*(options: RunOptions, output: string, admission?: { readonly admission: GateAdmission; readonly bytes: number }) {
  const fs = yield* FileSystem.FileSystem;
  const logs = join(output, 'node');
  yield* fs.makeDirectory(logs, { recursive: true });
  const eventDirectory = resolve(process.env.CONCORD_TEST_EVENT_DIRECTORY ?? join(output, 'process-events'));
  const eventRun = process.env.CONCORD_TEST_FILE_ID === undefined ? process.env.CONCORD_TEST_RUN_ID ?? randomUUID() : randomUUID();
  const preload = new URL('../test/support/source-runtime.ts', import.meta.url);
  preload.searchParams.set('eventDirectory', eventDirectory);
  preload.searchParams.set('eventRun', eventRun);
  yield* fs.writeFileString(join(output, 'process-event-run.json'), `${JSON.stringify({ run: eventRun, directory: eventDirectory })}\n`);
  let success = true;
  const runCounts = { tests: 0, failed: 0, cancelled: 0 };
  const fileTimings = new Map<string, { file: string; duration_ms: number; success: boolean }>();
  const fileProcesses = new Set<string>();
  const fileCases = new Map<string, number>();
  const diagnose = Effect.fn('test.node.diagnostic')(function*(event: TestEvent) {
    const data = event.data;
    const file = data !== undefined && 'file' in data ? data.file : undefined;
    if (file !== undefined) {
      const id = createHash('sha256').update(file).digest('hex');
      const log = join(logs, `${basename(file)}-${id}.log`);
      // inspect is bounded and accepts circular Errors; never serialize the raw event.
      yield* fs.writeFileString(log, `${inspect(event, { depth: 8, maxStringLength: 100_000, maxArrayLength: 100 })}\n`, { flag: 'a' });
    }
    if (event.type === 'test:fail') {
      const error = inspect(event.data.details.error, { depth: 8, maxStringLength: 100_000, maxArrayLength: 100 });
      yield* fs.writeFileString(join(output, 'node-failures.jsonl'), `${JSON.stringify({ file, name: event.data.name, error })}\n`, { flag: 'a' });
    }
    if (event.type === 'test:summary') {
      if (file !== undefined) fileCases.set(file, event.data.counts.tests);
      const timing = { ...event.data, scope: file === undefined ? 'engine' : 'file',
        // Only the official runner's isolated file processes, never case descendants.
        ...(file === undefined ? { fileProcessStarts: fileProcesses.size } : {}) };
      yield* fs.writeFileString(process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl'), `${JSON.stringify(timing)}\n`, { flag: 'a' });
      if (file === undefined) {
        success &&= event.data.success;
        runCounts.tests += event.data.counts.tests;
        runCounts.failed += 'failed' in event.data.counts && typeof event.data.counts.failed === 'number'
          ? event.data.counts.failed
          : event.data.counts.tests - event.data.counts.passed - event.data.counts.skipped - event.data.counts.todo - event.data.counts.cancelled;
        runCounts.cancelled += event.data.counts.cancelled;
      }
    }
    if (event.type === 'test:dequeue' && options.isolation !== 'none' && file !== undefined && resolve(event.data.name) === file) fileProcesses.add(file);
    // A case can share its file's title; the wrapper completes last and owns its timing.
    if (event.type === 'test:complete' && file !== undefined && resolve(event.data.name) === file) {
      const timing = { file, duration_ms: event.data.details.duration_ms, success: event.data.details.passed };
      fileTimings.set(file, timing);
      yield* Effect.sync(() => console.error(`# Node file: ${file}; ${(timing.duration_ms / 1000).toFixed(3)}s; success=${timing.success}; logs=${logs}`));
    }
  });
  const engine = (files: string[]) => Effect.scoped(Effect.gen(function*() {
    const controller = new AbortController();
    const observation = yield* observeTestProcessTree(files[0]!, admission?.bytes ?? 0);
    yield* Effect.addFinalizer(() => Effect.gen(function*() {
      const report = yield* observation.finish.pipe(Effect.onExit(exit => Effect.sync(() => {
        if (exit._tag === 'Failure' && admission !== undefined) admission.admission.failed = true;
      })));
      yield* fs.writeFileString(join(output, 'process-tree-peaks.jsonl'), `${JSON.stringify(report)}\n`, { flag: 'a' });
      if (report.exceeded) yield* Effect.sync(() => console.error(`# Gate file exceeds memory budget: ${report.file}; sampled RSS+swap=${report.peakBytes}; budget=${report.budgetBytes}`));
    }).pipe(Effect.orDie));
    const events = yield* Effect.acquireRelease(
      Effect.try({ try: () => run({ ...options, files, shard: undefined, concurrency: 1,
        execArgv: [...(options.execArgv ?? []), '--import', preload.href], signal: controller.signal }), catch: cause => new TestRunnerFailed({ cause }) }),
      () => Effect.sync(() => controller.abort()),
    );
    async function* measured(): AsyncGenerator<TestEvent, void> {
      for await (const event of events) {
        await Effect.runPromise(diagnose(event));
        yield event;
      }
    }
    yield* Stream.fromAsyncIterable(tap(measured()), cause => new TestRunnerFailed({ cause })).pipe(
      Stream.runForEach(text => Effect.sync(() => { process.stdout.write(text); })),
    );
  }));
  const files = options.files ?? [];
  // Node owns file isolation, execution, filtering, timeouts and all reporter events.
  // Effect only controls admission; a new official engine starts after its permit.
  yield* Effect.forEach(files, file => {
    const execute: Effect.Effect<void, TestRunnerFailed | GateResourcesInvalid> = engine([file]);
    return admission === undefined ? execute : withGateAdmission(admission.admission, admission.bytes)(execute);
  }, { concurrency: typeof options.concurrency === 'number' ? options.concurrency : 1, discard: true });
  yield* fs.writeFileString(process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl'), `${JSON.stringify({ scope: 'run', success, counts: runCounts, fileProcessStarts: fileProcesses.size })}\n`, { flag: 'a' });
  const missing = files.filter(file => !fileTimings.has(resolve(file)));
  if (missing.length > 0) return yield* new TestRunnerFailed({ cause: new Error(`Official runner did not complete selected files: ${missing.join(', ')}`) });
  const sortedTimings = [...fileTimings.values()].map(timing => ({ ...timing,
    ...(fileCases.has(timing.file) ? { cases: fileCases.get(timing.file)! } : {}),
  })).sort((left, right) => right.duration_ms - left.duration_ms);
  yield* fs.writeFileString(join(output, 'file-timings.json'), `${JSON.stringify(sortedTimings, null, 2)}\n`);
  const layers = summarizeTestLayers(sortedTimings.map(timing => timing.file), sortedTimings);
  yield* fs.writeFileString(join(output, 'layer-timings.json'), `${JSON.stringify(layers, null, 2)}\n`);
  for (const layer of layers) {
    yield* Effect.sync(() => console.error(`# Node layer ${layer.layer}: files=${layer.files}; cases=${layer.cases}; countedFiles=${layer.countedFiles}; ${(layer.duration_ms / 1000).toFixed(3)}s (sum of file durations)`));
  }
  return !success;
});
