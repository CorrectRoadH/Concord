// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runNodeTests } from './test-reporter.ts';
import { currentGateMemoryMax, gateConcurrency, gateAdmissionBytes, gateMemoryBudgets, makeGateAdmission } from './gate-resources.ts';
import { auditTestLayers, summarizeMeasuredTestLayers } from './test-layers.ts';
import { readFileTimings, summarizeFileTimings, timingMeasurement, writeTimingReport, type Measurement } from './gate-timings.ts';
import { writeProcessEventReport } from './process-events.ts';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}
const main = Effect.scoped(Effect.gen(function* () {
  // Keep one detached ownership boundary around every admitted engine and
  // its descendants. Cancelling its supervisor reclaims stubborn test descendants too.
  if (process.env.CONCORD_TEST_ADMISSION_WORKER !== '1') {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      env: { ...process.env, CONCORD_TEST_ADMISSION_WORKER: '1', NODE_TEST_CONTEXT: undefined },
      detached: process.platform !== 'win32', stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: Duration.seconds(5),
    }));
    yield* Effect.addFinalizer(() => child.kill({ forceKillAfter: Duration.seconds(5) }).pipe(
      Effect.ensuring(child.kill({ killSignal: 'SIGKILL' }).pipe(Effect.ignore)), Effect.ignore,
    ));
    const code = yield* child.exitCode;
    yield* Effect.sync(() => { process.exitCode = Number(code); });
    return;
  }
  yield* Effect.sync(() => { delete process.env.CONCORD_TEST_ADMISSION_WORKER; });
  // Only the gate's immediate test task owns this destination; nested runners don't.
  const gateOutput = process.env.CONCORD_GATE_TEST_OUTPUT;
  const selectedFiles = process.env.CONCORD_GATE_TEST_FILES;
  const allFiles = process.env.CONCORD_GATE_ALL_TEST_FILES;
  yield* Effect.sync(() => { delete process.env.CONCORD_GATE_TEST_OUTPUT; delete process.env.CONCORD_GATE_TEST_FILES; delete process.env.CONCORD_GATE_ALL_TEST_FILES; });
  const fs = yield* FileSystem.FileSystem;
  const memoryMaxBytes = currentGateMemoryMax();
  const { node: concurrency } = yield* Effect.try({
    try: () => gateConcurrency(memoryMaxBytes),
    catch: cause => new TestArgumentsInvalid({ detail: String(cause) }),
  });
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
      'test-name-pattern': { type: 'string' },
      'test-shard': { type: 'string' },
    } }),
    catch: cause => new TestArgumentsInvalid({ detail: String(cause) }),
  });
  const shard = yield* Effect.try({ try: () => {
    if (values['test-shard'] === undefined) return undefined;
    const raw = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[1-9]\d*\/[1-9]\d*$/u)))(values['test-shard']);
    const [index, total] = Schema.decodeUnknownSync(Schema.Tuple([Concurrency, Concurrency]))(raw.split('/'));
    if (index > total) throw new Error('Shard index exceeds the shard count');
    return { index, total };
  }, catch: cause => new TestArgumentsInvalid({ detail: `--test-shard: ${String(cause)}` }) });
  for (const file of positionals) {
    if (!file.endsWith('.test.ts') || !(yield* fs.exists(file))) {
      return yield* new TestArgumentsInvalid({ detail: `Not a test file: ${file}` });
    }
  }
  const files = selectedFiles === undefined
    ? positionals.length > 0 ? positionals : yield* fs.glob('test/**/*.test.ts')
    : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(selectedFiles);
  const nodeFiles = files.filter(file => file.endsWith('.test.ts'));
  if (allFiles !== undefined) {
    const inventory = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(allFiles);
    yield* Effect.try({ try: () => auditTestLayers(inventory), catch: cause => cause });
  }
  const capacity = gateAdmissionBytes(memoryMaxBytes);
  const admission = yield* makeGateAdmission(capacity);
  const started = performance.now();
  yield* fs.makeDirectory('.test-results', { recursive: true });
  const output = resolve(gateOutput ?? (yield* fs.makeTempDirectory({ directory: '.test-results', prefix: 'run-' })));
  const env: NodeJS.ProcessEnv = { ...process.env,
    // Public source exports are inherited by product and adapter children.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=concord-source`.trim(),
    // A nested runner is a new parent, not an official isolated test child.
    NODE_TEST_CONTEXT: undefined,
    CONCORD_NODE_OUTPUT: output };
  yield* Effect.sync(() => console.error(`# Source tests prepared in ${(performance.now() - started).toFixed(0)}ms; Bun concurrency=${concurrency}\n# Test diagnostics: ${output}\n# Machine load: ${loadavg().map(value => value.toFixed(2)).join(', ')}; CPUs=${availableParallelism()}`));
  const phases: { name: string; measurement: Measurement }[] = [];
  const selectedNode = nodeFiles.filter((_, index) => shard === undefined || index % shard.total === shard.index - 1);
  const nodeSuite = Effect.fn('test.admittedNodeSuite')(function*(files: string[]) {
    if (files.length === 0) return false;
    const suiteStarted = performance.now();
    yield* Effect.sync(() => {
      for (const [name, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      delete process.env.CONCORD_NODE_OUTPUT;
    });
    const failed = yield* runNodeTests({ files: files.map(file => resolve(file)), concurrency,
      testNamePatterns: values['test-name-pattern'], timeout: Duration.toMillis(Duration.minutes(5)),
    }, output, { admission, bytes: gateMemoryBudgets.node, history: true });
    const elapsed = performance.now() - suiteStarted;
    phases.push({ name: 'Source Bun', measurement: timingMeasurement('suite-wallclock', [{ duration_ms: elapsed, success: !failed }], 1) });
    yield* Effect.sync(() => console.error(`# Source Bun tests: ${(elapsed / 1000).toFixed(3)}s; exit=${failed ? 1 : 0}`));
    return failed;
  });
  const failed = yield* nodeSuite(selectedNode);
  const nodeTimings = yield* readFileTimings(join(output, 'file-timings.json'));
  yield* fs.writeFileString(join(output, 'file-timings.json'), `${JSON.stringify(nodeTimings.map(row => ({ ...row, metric: 'node-file-elapsed-sum' })).sort((left, right) => right.duration_ms - left.duration_ms), null, 2)}\n`);
  const layers = summarizeMeasuredTestLayers(selectedNode, nodeTimings);
  yield* fs.writeFileString(join(output, 'layer-timings.json'), `${JSON.stringify(layers, null, 2)}\n`);
  yield* Effect.sync(() => {
    for (const row of layers) console.error(`# Gate layer ${row.layer}: files=${row.files}; timedFiles=${row.timedFiles}; cases=${row.cases}; countedFiles=${row.countedFiles}; observed=${(row.duration_ms / 1000).toFixed(3)}s; metric=${row.metric}; state=${row.state}`);
  });
  const report = {
    selection: { files, nodeFiles: selectedNode,
      namePattern: values['test-name-pattern'] ?? null, shard: values['test-shard'] ?? null },
    concurrency: { node: concurrency },
    admission: { timings: admission.timings, capacityBytes: capacity, budgets: gateMemoryBudgets, nodeConcurrencyIsUpperLimit: true,
      processTreeReports: [join(output, 'process-tree-peaks.jsonl')] },
    node: summarizeFileTimings(selectedNode, nodeTimings, 'node-file-elapsed-sum', !failed),
    phases: [{ name: 'Source Bun', ...(phases[0]?.measurement ?? timingMeasurement('suite-wallclock', [], 0)) }],
    wallclock: timingMeasurement('test-runner-wallclock', [{ duration_ms: performance.now() - started, success: !failed }], 1),
  };
  yield* writeTimingReport(output, 'test-timings.json', report);
  yield* writeProcessEventReport(output, selectedNode);
  yield* Effect.sync(() => { process.exitCode = failed ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
