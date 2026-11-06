// @concord-file
// @concord-implements docs/engineering/testing/use-case/split-slow-test.md
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { run, type RunOptions } from 'node:test';
import { tap } from 'node:test/reporters';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { summarizeTestLayers } from './test-layers.ts';

type TestEvent = Parameters<typeof tap>[0] extends AsyncIterable<infer Event> ? Event : never;
class TestRunnerFailed extends Schema.TaggedError<TestRunnerFailed>()('TestRunnerFailed', {
  cause: Schema.Defect(),
}) {}

/** Keep project diagnostics beside the unmodified official reporter stream. */
export const runNodeTests = Effect.fn('test.node')(function*(options: RunOptions, output: string) {
  const fs = yield* FileSystem.FileSystem;
  const logs = join(output, 'node');
  yield* fs.makeDirectory(logs, { recursive: true });
  const controller = new AbortController();
  const events = yield* Effect.acquireRelease(
    Effect.try({ try: () => run({ ...options, signal: controller.signal }), catch: cause => new TestRunnerFailed({ cause }) }),
    () => Effect.sync(() => controller.abort()),
  );
  let success = false;
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
      const timing = { ...event.data, scope: file === undefined ? 'run' : 'file',
        // Only the official runner's isolated file processes, never case descendants.
        ...(file === undefined ? { fileProcessStarts: fileProcesses.size } : {}) };
      yield* fs.writeFileString(process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl'), `${JSON.stringify(timing)}\n`, { flag: 'a' });
      if (file === undefined) success = event.data.success;
    }
    if (event.type === 'test:dequeue' && options.isolation !== 'none' && file !== undefined && resolve(event.data.name) === file) fileProcesses.add(file);
    // A case can share its file's title; the wrapper completes last and owns its timing.
    if (event.type === 'test:complete' && file !== undefined && resolve(event.data.name) === file) {
      const timing = { file, duration_ms: event.data.details.duration_ms, success: event.data.details.passed };
      fileTimings.set(file, timing);
      yield* Effect.sync(() => console.error(`# Node file: ${file}; ${(timing.duration_ms / 1000).toFixed(3)}s; success=${timing.success}; logs=${logs}`));
    }
  });
  async function* measured(): AsyncGenerator<TestEvent, void> {
    for await (const event of events) {
      await Effect.runPromise(diagnose(event));
      yield event;
    }
  }
  yield* Stream.fromAsyncIterable(tap(measured()), cause => new TestRunnerFailed({ cause })).pipe(
    Stream.runForEach(text => Effect.sync(() => { process.stdout.write(text); })),
  );
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
