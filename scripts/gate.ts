// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';
import { checkoutRoot } from './build-output.ts';
import { gateMemoryBudgets, withGateResources } from './gate-resources.ts';
import { GateProcessIdentity, observeFixedGateMemory, observeTestProcessTree } from './gate-resource-processes.ts';
import { withGateQueue } from './gate-queue.ts';
import { isFullGateSelection, selectGateTests } from './gate-selection.ts';
import { readTestTimingReport, timingMeasurement, writeTimingReport } from './gate-timings.ts';

class DistInCheckout extends Schema.TaggedError<DistInCheckout>()('DistInCheckout', { message: Schema.String }) {}

const task = Effect.fn('gate.task')(function* (name: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = process.env) {
  const started = performance.now();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const observation = name === 'test:source' ? undefined : yield* observeTestProcessTree(name, gateMemoryBudgets.fixed);
  const code = yield* spawner.exitCode(ChildProcess.make('vp', ['run', name, ...args], {
    env: { ...env, CONCORD_GATE_TEST_OUTPUT: name === 'test:source' ? process.env.CONCORD_GATE_REPORT : undefined },
    stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: Duration.seconds(5),
  })).pipe(Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return 1; })));
  const memory = observation === undefined ? null : yield* observation.finish;
  return { name, memory, code: Number(code), duration_ms: performance.now() - started, success: Number(code) === 0 };
}, Effect.scoped);

const main = (selected: Effect.Success<ReturnType<typeof selectGateTests>>) => Effect.gen(function*() {
  const started = performance.now();
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(join(checkoutRoot, 'dist'))) return yield* new DistInCheckout({ message: 'Delete dist/ from the checkout before running pnpm gate. Tests run source; build packages with vp build --outDir <external-directory>.' });
  // Keep fixture fsync traffic off the checkout disk. tmpfs pages are charged
  // to this gate's memory scope, and the same scope owns their removal.
  const fixtureDirectory = yield* (process.platform === 'linux' && (yield* fs.exists('/dev/shm'))
    ? fs.makeTempDirectory({ directory: '/dev/shm', prefix: 'concord-gate-tests-' }).pipe(
      Effect.catch(() => fs.makeTempDirectory({ prefix: 'concord-gate-tests-' })),
    )
    : fs.makeTempDirectory({ prefix: 'concord-gate-tests-' }));
  yield* Effect.sync(() => {
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --conditions=concord-source`.trim();
  });
  const output = resolve(process.env.CONCORD_GATE_REPORT!);
  yield* fs.writeFileString(join(output, 'selection.json'), `${JSON.stringify(selected.selection, null, 2)}\n`);
  const retainedFile = join(output, 'retained-consumers.jsonl');
  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    const retained = (yield* fs.exists(retainedFile))
      ? yield* Effect.forEach((yield* fs.readFileString(retainedFile)).split('\n').filter(Boolean), path => fs.exists(path)) : [];
    if (retained.some(Boolean)) {
      yield* Effect.sync(() => console.error(`# Gate fixture cleanup unconfirmed; retained=${fixtureDirectory}; receipt=${retainedFile}`));
    } else yield* fs.remove(fixtureDirectory, { recursive: true, force: true });
  }).pipe(Effect.orDie));
  const eventDirectory = join(output, 'process-events');
  yield* fs.makeDirectory(eventDirectory, { recursive: true });
  const fixedObservation = yield* observeFixedGateMemory(gateMemoryBudgets.fixed);
  const env = { ...process.env,
    CONCORD_TEST_RETAIN_FILE: retainedFile, CONCORD_TEST_EVENT_DIRECTORY: eventDirectory, CONCORD_TEST_RUN_ID: output,
    TMPDIR: fixtureDirectory, TMP: fixtureDirectory, TEMP: fixtureDirectory,
    CONCORD_GATE_TEST_FILES: JSON.stringify(selected.files), CONCORD_GATE_ALL_TEST_FILES: JSON.stringify(selected.allFiles) };
  const names = ['gate:source', 'gate:tests', 'gate:scripts', 'gate:web', 'gate:lint', 'gate:selfhost', 'test:source'];
  // Vite+ dependencies stop on failure; acceptance must finish every sibling.
  yield* Effect.sync(() => console.error(`# Gate fixture directory: ${fixtureDirectory}; lifetime=gate; included in memory scope`));
  const [statics, testsTask] = yield* Effect.all([
    Effect.all(names.filter(name => name !== 'test:source').map(name => task(name)), { concurrency: 2 }),
    task('test:source', selected.args, env),
  ], { concurrency: 'unbounded' });
  const tasks = [...statics, testsTask];
  const ownership = Schema.Struct({ processes: Schema.Array(GateProcessIdentity) });
  const admitted: GateProcessIdentity[] = [];
  for (const file of yield* fs.glob('**/process-tree-peaks.jsonl', { root: output })) {
    for (const line of (yield* fs.readFileString(join(output, file))).split('\n').filter(Boolean)) {
      admitted.push(...(yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ownership))(line)).processes);
    }
  }
  const browserMemoryPath = join(output, 'browser-process-trees.json');
  if (yield* fs.exists(browserMemoryPath)) {
    const rows = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(ownership)))(yield* fs.readFileString(browserMemoryPath));
    for (const row of rows) admitted.push(...row.processes);
  }
  const fixedMemory = yield* fixedObservation.finish(admitted, testsTask.code === 0);
  const codes = tasks.map(task => task.code);
  const successful = codes.every(code => code === 0);
  const elapsed = performance.now() - started;
  const tests = yield* readTestTimingReport(output);
  yield* writeTimingReport(output, 'gate-timings.json', {
    selection: selected.selection, args: selected.args,
    wallclock: { report: join(output, 'resources.json'), field: 'wallclockMs', observedField: 'observedWallclockMs', state: 'external-report', metric: 'gate-command-wallclock' },
    gateBody: timingMeasurement('gate-body-wallclock', [{ duration_ms: elapsed, success: successful }], 1),
    fixedMemory,
    static: tasks.filter(task => task.name !== 'test:source').map(task => ({ name: task.name, memory: task.memory, ...timingMeasurement('task-wallclock', [task], 1) })),
    tests, testReportState: tests === null ? 'unknown' : 'known',
    memoryPeak: { report: join(output, 'resources.json'), state: 'external-report', metric: 'whole-gate-process-tree-peak-bytes' },
    notes: ['Parallel task, file and attempt sums are not gate wallclock.', 'Worker spans include nested fixture spans; do not add them.', 'resources.json owns overall wallclock and memory peaks, finalized after resource supervisor teardown.'],
  });
  yield* Effect.sync(() => {
    console.error(`# Gate total: ${(elapsed / 1000).toFixed(3)}s; metric=gate-body-wallclock; overall=${join(output, 'resources.json')}; timing report=${join(output, 'gate-timings.json')}`);
    console.error(`# Gate results: ${names.map((name, index) => `${name}=${codes[index]}`).join(', ')}`);
    process.exitCode = successful ? 0 : 1;
  });
});

const entry = Effect.gen(function*() {
  const selected = yield* selectGateTests(process.argv.slice(2), checkoutRoot);
  const guarded = withGateResources(main(selected));
  return yield* (process.env.CONCORD_GATE_SCOPE ? guarded : withGateQueue(guarded, undefined, { demand: isFullGateSelection(selected) ? 'all' : 1 }));
});
entry.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
