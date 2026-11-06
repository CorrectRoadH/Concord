// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Deferred, Duration, Effect, Fiber, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initializeNodeCompileCache } from '../src/base/installation/startup/index.ts';
import { runNodeTests } from './test-reporter.ts';
import { currentGateMemoryMax, gateConcurrency } from './gate-resources.ts';
import { auditTestLayers, summarizeMeasuredTestLayers } from './test-layers.ts';
import { readBrowserLifecycle, readBrowserSelection, readFileTimings, summarizeBrowserLifecycle, summarizeFileTimings, timingMeasurement, writeTimingReport, type Measurement } from './gate-timings.ts';
import { isPackagingTest, preparePackagingFixture, shardNodeFiles, waitForPackagePreparation } from './gate-package.ts';
import { writeProcessEventReport } from './process-events.ts';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}
const main = Effect.scoped(Effect.gen(function* () {
  // Only the gate's immediate test task owns this destination; nested runners don't.
  const gateOutput = process.env.CONCORD_GATE_TEST_OUTPUT;
  const selectedFiles = process.env.CONCORD_GATE_TEST_FILES;
  const allFiles = process.env.CONCORD_GATE_ALL_TEST_FILES;
  const packagePreparation = process.env.CONCORD_GATE_PACKAGE_PREPARATION;
  yield* Effect.sync(() => { delete process.env.CONCORD_GATE_TEST_OUTPUT; delete process.env.CONCORD_GATE_TEST_FILES; delete process.env.CONCORD_GATE_ALL_TEST_FILES; delete process.env.CONCORD_GATE_PACKAGE_PREPARATION; });
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { node: concurrency, browser: browserConcurrency } = yield* Effect.try({
    try: () => gateConcurrency(currentGateMemoryMax()),
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
    if (values['test-shard'] === undefined) return undefined;
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
  const nodeFiles = files.filter(file => file.endsWith('.test.ts'));
  const browserFiles = files.filter(file => file.endsWith('.e2e.ts'));
  if (values['node-worker']) {
    const output = process.env.CONCORD_NODE_OUTPUT;
    if (output === undefined) return yield* new TestArgumentsInvalid({ detail: 'Node worker requires CONCORD_NODE_OUTPUT' });
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
      return yield* child.exitCode;
    })).pipe(Effect.catch(cause => Effect.sync(() => { console.error(`# Test suite failed: ${String(cause)}`); return 1; })));
    const elapsed = performance.now() - suiteStarted;
    phases.push({ name, measurement: timingMeasurement(name === 'Packaging Node' ? 'serial-packaging-wallclock' : 'suite-wallclock', [{ duration_ms: elapsed, success: Number(code) === 0 }], 1) });
    yield* Effect.sync(() => console.error(`# ${name} tests: ${(elapsed / 1000).toFixed(3)}s; exit=${code}`));
    return Number(code) !== 0;
  }, Effect.catch(cause => Effect.sync(() => { console.error(`# Test suite failed: ${String(cause)}`); return true; })));
  const nameFlags = [
    ...(values['test-name-pattern'] === undefined ? [] : [`--test-name-pattern=${values['test-name-pattern']}`]),
  ];
  // Apply the official file shard before splitting off the one packaging owner.
  const selectedNode = browserOnly ? [] : shardNodeFiles(nodeFiles, shard);
  const packageFiles = selectedNode.filter(file => isPackagingTest(file));
  const sourceFiles = selectedNode.filter(file => !isPackagingTest(file));
  const split = packageFiles.length > 0 && sourceFiles.length > 0;
  const sourceOutput = split ? join(output, 'node-source') : output;
  const packageOutput = split ? join(output, 'node-package') : output;
  // Direct runner invocations may explicitly accept a prebuilt archive. The gate
  // always supplies its own preparation receipt and retains the cache lease.
  const directPreparation = packageFiles.length > 0 && packagePreparation === undefined && process.env.CONCORD_TEST_PACKAGE_ROOT === undefined
    ? yield* preparePackagingFixture(process.cwd(), join(output, 'archive-preparation.json')).pipe(Effect.forkScoped)
    : undefined;
  const sourceCompleted = yield* Deferred.make<void>();
  const sourceTests = (sourceFiles.length > 0
    ? suite('Source Node', process.execPath, [fileURLToPath(import.meta.url), '--node-worker', '--suite=node', ...nameFlags, ...sourceFiles], {
      ...env, CONCORD_NODE_OUTPUT: sourceOutput, CONCORD_TEST_CONCURRENCY: String(concurrency),
      CONCORD_TEST_PACKAGE_ROOT: undefined, CONCORD_TEST_PACKAGE_BUILD_STATUS: undefined,
    }) : Effect.succeed(false)).pipe(Effect.ensuring(Deferred.succeed(sourceCompleted, undefined)));
  const packageTests = packageFiles.length > 0 ? Effect.gen(function*() {
    const prepared = packagePreparation !== undefined ? yield* waitForPackagePreparation(packagePreparation)
      : directPreparation !== undefined ? yield* Fiber.join(directPreparation) : undefined;
    if (prepared?.state === 'failed') {
      yield* Effect.sync(() => console.error(`# Packaging preparation failed: ${prepared.message}`));
      return true;
    }
    // The archive's installed copies and independent acceptance processes share
    // the same memory boundary as source tests. Preparation remains parallel.
    if (sourceFiles.length > 0) yield* Effect.sync(() => console.error('# Packaging waits for Source Node completion'));
    yield* Deferred.await(sourceCompleted);
    return yield* suite('Packaging Node', process.execPath, [fileURLToPath(import.meta.url), '--node-worker', '--suite=node', ...nameFlags, ...packageFiles], {
      ...env, CONCORD_NODE_OUTPUT: packageOutput, CONCORD_TEST_CONCURRENCY: '1',
      CONCORD_TEST_PACKAGE_ROOT: prepared?.packageRoot ?? process.env.CONCORD_TEST_PACKAGE_ROOT,
    });
  }) : Effect.succeed(false);
  const nodeTests = Effect.all([sourceTests, packageTests], { concurrency: concurrency > 1 ? 'unbounded' : 1 }).pipe(Effect.map(results => results.some(Boolean)));
  const browserTests = values.suite !== 'node' && browserFiles.length > 0
    ? suite('Browser', 'pnpm', ['exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]), ...browserFiles])
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
    node: summarizeFileTimings(selectedNode, nodeTimings, 'node-file-elapsed-sum', !failures[0]),
    browser: summarizeFileTimings(selectedBrowser, browserTimings, 'browser-attempt-sum', !failures[1] && reportedBrowser !== null),
    browserLifecycle: summarizeBrowserLifecycle(lifecycle, requestedBrowser.length > 0, !failures[1]),
    phases: ['Source Node', 'Packaging Node', 'Browser'].map(name => ({ name,
      ...(phases.find(phase => phase.name === name)?.measurement ?? timingMeasurement(name === 'Packaging Node' ? 'serial-packaging-wallclock' : 'suite-wallclock', [],
        (name === 'Source Node' ? sourceFiles : name === 'Packaging Node' ? packageFiles : selectedBrowser).length > 0 ? 1 : 0)) })),
    wallclock: timingMeasurement('test-runner-wallclock', [{ duration_ms: performance.now() - started, success: !failures.some(Boolean) }], 1),
  };
  yield* writeTimingReport(output, 'test-timings.json', report);
  yield* writeProcessEventReport(output, [...selectedNode, ...selectedBrowser]);
  yield* Effect.sync(() => { process.exitCode = failures.some(Boolean) ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
