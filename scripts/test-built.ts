// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { Duration, Effect, Fiber, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initializeNodeCompileCache } from '../src/base/installation/startup/index.ts';
import { observeBrowserProcessTrees, observeTestProcessTree } from './gate-resource-processes.ts';
import { runNodeTests } from './test-reporter.ts';
import { currentGateMemoryMax, gateConcurrency, gateAdmissionBytes, gateAdmittedBrowserWorkers, gateMemoryBudgets, GateResourcesInvalid, makeGateAdmission, withGateAdmission } from './gate-resources.ts';
import { auditTestLayers, summarizeMeasuredTestLayers } from './test-layers.ts';
import { readBrowserLifecycle, readBrowserSelection, readFileTimings, summarizeBrowserLifecycle, summarizeFileTimings, timingMeasurement, writeTimingReport, type Measurement } from './gate-timings.ts';
import { isPackagingTest, preparePackagingFixture, shardNodeFiles, waitForPackagePreparation } from './gate-package.ts';
import { writeProcessEventReport } from './process-events.ts';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}
const main = Effect.scoped(Effect.gen(function* () {
  // Keep one detached ownership boundary around every admitted engine and
  // browser. Cancelling its supervisor reclaims stubborn test descendants too.
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
  const packagePreparation = process.env.CONCORD_GATE_PACKAGE_PREPARATION;
  const ownPreparation = process.env.CONCORD_GATE_PREPARE_PACKAGE;
  const prebuiltPackageRoot = process.env.CONCORD_TEST_PACKAGE_ROOT;
  yield* Effect.sync(() => { delete process.env.CONCORD_GATE_TEST_OUTPUT; delete process.env.CONCORD_GATE_TEST_FILES; delete process.env.CONCORD_GATE_ALL_TEST_FILES; delete process.env.CONCORD_GATE_PACKAGE_PREPARATION; delete process.env.CONCORD_GATE_PREPARE_PACKAGE; });
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const memoryMaxBytes = currentGateMemoryMax();
  const { node: concurrency, browser: browserUpperLimit } = yield* Effect.try({
    try: () => gateConcurrency(memoryMaxBytes),
    catch: cause => new TestArgumentsInvalid({ detail: String(cause) }),
  });
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
      'test-name-pattern': { type: 'string' },
      'test-shard': { type: 'string' },
      suite: { type: 'string', default: 'all' },
      'node-worker': { type: 'boolean', default: false },
    } }),
    catch: cause => new TestArgumentsInvalid({ detail: String(cause) }),
  });
  if (!['all', 'node', 'e2e', 'agent'].includes(values.suite)) return yield* new TestArgumentsInvalid({ detail: `Unknown suite: ${values.suite}` });
  const browserOnly = values.suite === 'e2e' || values.suite === 'agent';
  const shard = yield* Effect.try({ try: () => {
    if (values['test-shard'] === undefined || values['test-shard'] === 'package') return undefined;
    const raw = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[1-9]\d*\/[1-9]\d*$/u)))(values['test-shard']);
    const [index, total] = Schema.decodeUnknownSync(Schema.Tuple([Concurrency, Concurrency]))(raw.split('/'));
    if (index > total) throw new Error('Shard index exceeds the shard count');
    return { index, total };
  }, catch: cause => new TestArgumentsInvalid({ detail: `--test-shard: ${String(cause)}` }) });
  for (const file of positionals) {
    if ((!file.endsWith('.test.ts') && !file.endsWith('.e2e.ts')) || !(yield* fs.exists(file))) {
      return yield* new TestArgumentsInvalid({ detail: `Not a test file: ${file}` });
    }
    if ((values.suite === 'node' && file.endsWith('.e2e.ts')) || (browserOnly && file.endsWith('.test.ts'))) {
      return yield* new TestArgumentsInvalid({ detail: `File does not belong to ${values.suite}: ${file}` });
    }
  }
  const files = selectedFiles === undefined
    ? positionals.length > 0 ? positionals : [...yield* fs.glob('test/**/*.test.ts'), ...yield* fs.glob('test/**/*.e2e.ts')]
    : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(selectedFiles);
  const packageOnly = values['test-shard'] === 'package';
  const nodeFiles = files.filter(file => file.endsWith('.test.ts') && (!packageOnly || isPackagingTest(file)) && (shard === undefined || !isPackagingTest(file)));
  const browserFiles = packageOnly ? [] : files.filter(file => file.endsWith('.e2e.ts'));
  if (values['node-worker']) {
    const output = process.env.CONCORD_NODE_OUTPUT;
    if (output === undefined) return yield* new TestArgumentsInvalid({ detail: 'Node worker requires CONCORD_NODE_OUTPUT' });
    // The parent holds packaging admission until this runner and its tree exit.
    const failed = yield* runNodeTests({
      files: nodeFiles.map(file => resolve(file)),
      isolation: 'process', concurrency, shard,
      testNamePatterns: values['test-name-pattern'],
      timeout: Duration.toMillis(Duration.minutes(5)),
      execArgv: ['--conditions=concord-source', '--import', new URL('../test/support/source-runtime.ts', import.meta.url).href],
    }, output);
    yield* Effect.sync(() => { process.exitCode = failed ? 1 : 0; });
    return;
  }
  if (allFiles !== undefined) {
    const inventory = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(allFiles);
    yield* Effect.try({ try: () => auditTestLayers(inventory), catch: cause => cause });
  }
  const browserConcurrency = gateAdmittedBrowserWorkers(memoryMaxBytes, browserUpperLimit);
  const browserSelected = values.suite !== 'node' && browserFiles.length > 0;
  const capacity = gateAdmissionBytes(memoryMaxBytes);
  if (browserSelected && browserConcurrency < 1) return yield* new GateResourcesInvalid({ detail: `Browser worker needs ${gateMemoryBudgets.browser} bytes; admission pool has ${capacity}` });
  const admission = yield* makeGateAdmission(capacity);
  const started = performance.now();
  yield* fs.makeDirectory('.test-results', { recursive: true });
  const output = resolve(gateOutput ?? (yield* fs.makeTempDirectory({ directory: '.test-results', prefix: 'run-' })));
  const compileCache = yield* Effect.sync(initializeNodeCompileCache);
  const env: NodeJS.ProcessEnv = { ...process.env,
    // Public source exports are inherited by product and adapter children.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=concord-source`.trim(),
    NODE_COMPILE_CACHE: compileCache, CONCORD_TEST_COMPILE_CACHE: compileCache,
    // A nested runner is a new parent, not an official isolated test child.
    NODE_TEST_CONTEXT: undefined,
    CONCORD_NODE_OUTPUT: output,
    CONCORD_E2E_OUTPUT: join(output, 'e2e'), E2E_TELEMETRY_DISABLED: '1',
    CONCORD_E2E_AGENT: values.suite === 'agent' ? '1' : '0' };
  yield* Effect.sync(() => console.error(`# Source tests prepared in ${(performance.now() - started).toFixed(0)}ms; Node concurrency=${concurrency}; e2e workers=${browserConcurrency}\n# Test diagnostics: ${output}\n# Machine load: ${loadavg().map(value => value.toFixed(2)).join(', ')}; CPUs=${availableParallelism()}`));
  const phases: { name: string; measurement: Measurement }[] = [];
  const suite = Effect.fn('test.suite')(function*(name: string, executable: string, args: string[], suiteEnv: NodeJS.ProcessEnv = env) {
    const suiteStarted = performance.now();
    const code = yield* Effect.scoped(Effect.gen(function*() {
      const observation = name === 'Packaging Node' ? yield* observeTestProcessTree('packaging-runner', gateMemoryBudgets.packaging, ['--node-worker']) : undefined;
      const browserObservation = name === 'Browser' ? yield* observeBrowserProcessTrees(join(output, 'e2e'), gateMemoryBudgets.browser) : undefined;
      const child = yield* spawner.spawn(ChildProcess.make(executable, args, {
        env: suiteEnv, detached: process.platform !== 'win32', forceKillAfter: Duration.seconds(5),
        stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
      }));
      // The suite parent may exit before a descendant that ignores SIGTERM.
      // Close the entire group after awaiting its parent, including that tail.
      yield* Effect.addFinalizer(() => child.kill({ forceKillAfter: Duration.seconds(5) }).pipe(
        Effect.ensuring(child.kill({ killSignal: 'SIGKILL' }).pipe(Effect.ignore)),
        Effect.ignore,
      ));
      const code = yield* child.exitCode;
      if (observation !== undefined) {
        const memory = yield* observation.finish.pipe(Effect.onExit(exit => Effect.sync(() => { if (exit._tag === 'Failure') admission.failed = true; })));
        yield* fs.writeFileString(join(output, 'packaging-process-tree.json'), `${JSON.stringify(memory)}\n`);
      }
      if (browserObservation !== undefined) {
        const memory = yield* browserObservation.finish.pipe(Effect.onExit(exit => Effect.sync(() => { if (exit._tag === 'Failure') admission.failed = true; })));
        yield* fs.writeFileString(join(output, 'browser-process-trees.json'), `${JSON.stringify(memory)}\n`);
        for (const worker of memory) if (worker.exceeded) yield* Effect.sync(() => console.error(`# Browser worker exceeds PSS budget: ${worker.file}; peak=${worker.peakBytes}; budget=${worker.budgetBytes}`));
      }
      return code;
    })).pipe(Effect.catch(cause => Effect.sync(() => { console.error(`# Test suite failed: ${String(cause)}`); return 1; })));
    const elapsed = performance.now() - suiteStarted;
    phases.push({ name, measurement: timingMeasurement(name === 'Packaging Node' ? 'packaging-wallclock' : 'suite-wallclock', [{ duration_ms: elapsed, success: Number(code) === 0 }], 1) });
    yield* Effect.sync(() => console.error(`# ${name} tests: ${(elapsed / 1000).toFixed(3)}s; exit=${code}`));
    return Number(code) !== 0;
  }, Effect.catch(cause => Effect.sync(() => { console.error(`# Test suite failed: ${String(cause)}`); return true; })));
  // Apply the official file shard before splitting off the one packaging owner.
  const selectedNode = browserOnly ? [] : shardNodeFiles(nodeFiles, shard);
  const packageFiles = selectedNode.filter(file => isPackagingTest(file));
  const sourceFiles = selectedNode.filter(file => !isPackagingTest(file));
  const required = packageFiles.length > 0 ? gateMemoryBudgets.packaging : 0;
  if (capacity < required) return yield* new GateResourcesInvalid({ detail: `Selected Node test file needs ${required} bytes; admission pool has ${capacity}` });
  const split = packageFiles.length > 0 && sourceFiles.length > 0;
  const sourceOutput = split ? join(output, 'node-source') : output;
  const packageOutput = split ? join(output, 'node-package') : output;
  // Direct runner invocations may explicitly accept a prebuilt archive. The gate
  // always supplies its own preparation receipt and retains the cache lease.
  const directPreparation = packageFiles.length > 0 && (ownPreparation !== undefined || packagePreparation === undefined && prebuiltPackageRoot === undefined)
    ? yield* preparePackagingFixture(process.cwd(), ownPreparation ?? join(output, 'archive-preparation.json'), admission).pipe(Effect.forkScoped)
    : undefined;
  const nodeSuite = Effect.fn('test.admittedNodeSuite')(function*(name: string, files: string[], destination: string, bytes: number, packageRoot?: string) {
    if (files.length === 0) return false;
    const suiteStarted = performance.now();
    yield* fs.makeDirectory(destination, { recursive: true });
    // Only source engines inherit this process environment. The packaging
    // runner has its own environment and holds the same admission pool permit.
    yield* Effect.sync(() => {
      for (const [name, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      if (packageRoot === undefined) { delete process.env.CONCORD_TEST_PACKAGE_ROOT; delete process.env.CONCORD_TEST_PACKAGE_BUILD_STATUS; }
      else process.env.CONCORD_TEST_PACKAGE_ROOT = packageRoot;
      delete process.env.CONCORD_NODE_OUTPUT;
    });
    const failed = yield* runNodeTests({ files: files.map(file => resolve(file)), isolation: 'process', concurrency,
      testNamePatterns: values['test-name-pattern'], timeout: Duration.toMillis(Duration.minutes(5)),
      execArgv: ['--conditions=concord-source', '--import', new URL('../test/support/source-runtime.ts', import.meta.url).href],
    }, destination, { admission, bytes, history: name === 'Source Node' });
    const elapsed = performance.now() - suiteStarted;
    phases.push({ name, measurement: timingMeasurement(name === 'Packaging Node' ? 'packaging-wallclock' : 'suite-wallclock', [{ duration_ms: elapsed, success: !failed }], 1) });
    yield* Effect.sync(() => console.error(`# ${name} tests: ${(elapsed / 1000).toFixed(3)}s; exit=${failed ? 1 : 0}`));
    return failed;
  });
  const sourceTests = nodeSuite('Source Node', sourceFiles, sourceOutput, gateMemoryBudgets.node);
  const packageTests = packageFiles.length > 0 ? Effect.gen(function*() {
    if (capacity < gateMemoryBudgets.packaging) return yield* new GateResourcesInvalid({ detail: `Packaging needs ${gateMemoryBudgets.packaging} bytes; admission pool has ${capacity}` });
    const prepared = packagePreparation !== undefined ? yield* waitForPackagePreparation(packagePreparation)
      : directPreparation !== undefined ? yield* Fiber.join(directPreparation) : undefined;
    if (prepared?.state === 'failed') {
      yield* Effect.sync(() => console.error(`# Packaging preparation failed: ${prepared.message}`));
      return true;
    }
    yield* fs.makeDirectory(packageOutput, { recursive: true });
    const packageEnv = { ...env, CONCORD_NODE_OUTPUT: packageOutput,
      CONCORD_TEST_PACKAGE_ROOT: prepared?.packageRoot ?? prebuiltPackageRoot };
    return yield* suite('Packaging Node', process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), '--node-worker', '--suite=node',
        ...(values['test-name-pattern'] === undefined ? [] : [`--test-name-pattern=${values['test-name-pattern']}`]), ...packageFiles], packageEnv)
      .pipe(withGateAdmission(admission, gateMemoryBudgets.packaging, 'packaging'));
  }) : Effect.succeed(false);
  const nodeTests = Effect.all([sourceTests, packageTests], { concurrency: 'unbounded' }).pipe(Effect.map(results => results.some(Boolean)));
  const browserTests = values.suite !== 'node' && browserFiles.length > 0
    ? suite('Browser', 'pnpm', ['exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]), ...browserFiles])
      .pipe(withGateAdmission(admission, browserConcurrency * gateMemoryBudgets.browser, 'browser'))
    : Effect.succeed(false);
  const failures = yield* Effect.all([nodeTests, browserTests], { concurrency: 'unbounded' });
  const nodeTimings = [];
  for (const directory of split ? [sourceOutput, packageOutput] : [output]) {
    const path = join(directory, 'file-timings.json');
    nodeTimings.push(...yield* readFileTimings(path));
  }
  yield* fs.writeFileString(join(output, 'file-timings.json'), `${JSON.stringify(nodeTimings.map(row => ({ ...row, metric: 'node-file-elapsed-sum' })).sort((left, right) => right.duration_ms - left.duration_ms), null, 2)}\n`);
  const browserTiming = join(output, 'e2e', 'file-timings.json');
  const browserTimings = yield* readFileTimings(browserTiming);
  const timings = [...nodeTimings, ...browserTimings];
  const requestedBrowser = values.suite === 'node' ? [] : browserFiles;
  const reportedBrowser = yield* readBrowserSelection(join(output, 'e2e'));
  // Browser shards select cases, so only the official report knows their file set.
  const selectedBrowser = requestedBrowser.length === 0 ? [] : reportedBrowser?.length === 0 && failures[1] ? requestedBrowser : reportedBrowser ?? requestedBrowser;
  const layers = summarizeMeasuredTestLayers([...selectedNode, ...selectedBrowser], timings);
  yield* fs.writeFileString(join(output, 'layer-timings.json'), `${JSON.stringify(layers, null, 2)}\n`);
  yield* Effect.sync(() => {
    for (const row of layers) console.error(`# Gate layer ${row.layer}: files=${row.files}; timedFiles=${row.timedFiles}; cases=${row.cases}; countedFiles=${row.countedFiles}; observed=${(row.duration_ms / 1000).toFixed(3)}s; metric=${row.metric}; state=${row.state}`);
  });
  const lifecycle = yield* readBrowserLifecycle(join(output, 'e2e'));
  const report = {
    selection: { files, nodeFiles: selectedNode, browserFiles: selectedBrowser, requestedBrowserFiles: requestedBrowser, suite: values.suite,
      namePattern: values['test-name-pattern'] ?? null, shard: values['test-shard'] ?? null },
    concurrency: { node: concurrency, browser: browserConcurrency, packaging: 1 as const },
    admission: { timings: admission.timings, capacityBytes: capacity, budgets: gateMemoryBudgets, nodeConcurrencyIsUpperLimit: true,
      browserReservation: 'all-workers-until-suite-exit', processTreeReports: split ? [join(sourceOutput, 'process-tree-peaks.jsonl'), join(packageOutput, 'process-tree-peaks.jsonl')] : [join(output, 'process-tree-peaks.jsonl')] },
    node: summarizeFileTimings(selectedNode, nodeTimings, 'node-file-elapsed-sum', !failures[0]),
    browser: summarizeFileTimings(selectedBrowser, browserTimings, 'browser-attempt-sum', !failures[1] && reportedBrowser !== null),
    browserLifecycle: summarizeBrowserLifecycle(lifecycle, requestedBrowser.length > 0, !failures[1]),
    phases: ['Source Node', 'Packaging Node', 'Browser'].map(name => ({ name,
      ...(phases.find(phase => phase.name === name)?.measurement ?? timingMeasurement(name === 'Packaging Node' ? 'packaging-wallclock' : 'suite-wallclock', [],
        (name === 'Source Node' ? sourceFiles : name === 'Packaging Node' ? packageFiles : selectedBrowser).length > 0 ? 1 : 0)) })),
    wallclock: timingMeasurement('test-runner-wallclock', [{ duration_ms: performance.now() - started, success: !failures.some(Boolean) }], 1),
  };
  yield* writeTimingReport(output, 'test-timings.json', report);
  yield* writeProcessEventReport(output, [...selectedNode, ...selectedBrowser]);
  yield* Effect.sync(() => { process.exitCode = failures.some(Boolean) ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
