// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Deferred, Duration, Effect, FileSystem, Schema } from 'effect';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, watch } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runNodeTests } from './test-reporter.js';
import { currentGateMemoryMax, gateConcurrency } from './gate-resources.js';
import { auditTestLayers, classifyTestLayer, summarizeTestLayers } from './test-layers.js';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}
class TestPackageBuildFailed extends Schema.TaggedError<TestPackageBuildFailed>()('TestPackageBuildFailed', { detail: Schema.String }) {}
const BuildStatus = Schema.fromJsonString(Schema.Struct({ code: Schema.Int }));

// Watch the round's completion receipt, rather than guessing how long a build takes.
const awaitPackage = Effect.fn('test.awaitPackage')(function*() {
  const root = process.env.CONCORD_TEST_PACKAGE_ROOT;
  if (root === undefined) return yield* new TestPackageBuildFailed({ detail: 'Installed tests require CONCORD_TEST_PACKAGE_ROOT from pnpm gate.' });
  const status = process.env.CONCORD_TEST_PACKAGE_BUILD_STATUS;
  if (status !== undefined) {
    const code = yield* Effect.callback<number, TestPackageBuildFailed>(resume => {
      const check = () => {
        try {
          if (existsSync(status)) {
            const code = Schema.decodeUnknownSync(BuildStatus, { onExcessProperty: 'error' })(readFileSync(status, 'utf8')).code;
            watcher.close();
            resume(Effect.succeed(code));
          }
        } catch (cause) { watcher.close(); resume(Effect.fail(new TestPackageBuildFailed({ detail: String(cause) }))); }
      };
      const watcher = watch(dirname(status), check);
      watcher.on('error', cause => { watcher.close(); resume(Effect.fail(new TestPackageBuildFailed({ detail: String(cause) }))); });
      check();
      return Effect.sync(() => watcher.close());
    });
    if (code !== 0) return yield* new TestPackageBuildFailed({ detail: `The gate package build exited ${code}; installed suites cannot start.` });
  }
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(join(root, 'package.json')))) return yield* new TestPackageBuildFailed({ detail: `Package missing at ${root}` });
});

const main = Effect.scoped(Effect.gen(function* () {
  // Only the gate's immediate test task owns this destination; nested runners don't.
  const gateOutput = process.env.CONCORD_GATE_TEST_OUTPUT;
  const selectedFiles = process.env.CONCORD_GATE_TEST_FILES;
  const allFiles = process.env.CONCORD_GATE_ALL_TEST_FILES;
  yield* Effect.sync(() => { delete process.env.CONCORD_GATE_TEST_OUTPUT; delete process.env.CONCORD_GATE_TEST_FILES; delete process.env.CONCORD_GATE_ALL_TEST_FILES; });
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
      execArgv: ['--conditions=concord-source', '--import', import.meta.resolve('tsx'), '--import', new URL('../test/support/source-runtime.ts', import.meta.url).href],
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
  // Compiled modules may be reused within this gate, never test verdicts.
  const compileCache = process.env.CONCORD_TEST_COMPILE_CACHE ?? join(output, 'node-compile-cache');
  if (process.env.CONCORD_TEST_COMPILE_CACHE === undefined) yield* Effect.addFinalizer(() => fs.remove(compileCache, { recursive: true, force: true }).pipe(Effect.orDie));
  const env: NodeJS.ProcessEnv = { ...process.env,
    // Load test TypeScript through execArgv. Product children inherit no source loader.
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
    NODE_COMPILE_CACHE: compileCache, CONCORD_TEST_COMPILE_CACHE: compileCache,
    // A nested runner is a new parent, not an official isolated test child.
    NODE_TEST_CONTEXT: undefined,
    CONCORD_NODE_OUTPUT: output,
    CONCORD_E2E_OUTPUT: join(output, 'e2e'), E2E_TELEMETRY_DISABLED: '1',
    CONCORD_E2E_AGENT: values.suite === 'agent' ? '1' : '0' };
  yield* Effect.sync(() => console.error(`# Source tests prepared in ${(performance.now() - started).toFixed(0)}ms; Node concurrency=${concurrency}; e2e workers=${browserConcurrency}\n# Test diagnostics: ${output}\n# Machine load: ${loadavg().map(value => value.toFixed(2)).join(', ')}; CPUs=${availableParallelism()}`));
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
    }));
    yield* Effect.sync(() => console.error(`# ${name} tests: ${((performance.now() - suiteStarted) / 1000).toFixed(3)}s; exit=${code}`));
    return Number(code) !== 0;
  }, Effect.catch(cause => Effect.sync(() => { console.error(`# Test suite failed: ${String(cause)}`); return true; })));
  const sourceFiles = nodeFiles.filter(file => !['cli', 'process'].includes(classifyTestLayer(file) ?? 'model'));
  const installedFiles = nodeFiles.filter(file => !sourceFiles.includes(file));
  const split = !browserOnly && sourceFiles.length > 0 && installedFiles.length > 0;
  const runnerFlags = [
    ...(values['test-name-pattern'] === undefined ? [] : [`--test-name-pattern=${values['test-name-pattern']}`]),
    ...(values['test-shard'] === undefined ? [] : [`--test-shard=${values['test-shard']}`]),
  ];
  const nodeSuite = (name: string, group: readonly string[], installed: boolean) => !browserOnly && group.length > 0
    ? suite(name, process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), '--node-worker', '--suite=node', ...runnerFlags, ...group], {
      ...env, CONCORD_NODE_OUTPUT: split ? join(output, installed ? 'node-installed' : 'node-source') : output,
      CONCORD_TEST_PACKAGE_ROOT: installed ? env.CONCORD_TEST_PACKAGE_ROOT : undefined,
      CONCORD_TEST_PACKAGE_BUILD_STATUS: undefined,
    }) : Effect.succeed(false);
  const browserTests = values.suite !== 'node' && browserFiles.length > 0
    ? suite('Browser', 'pnpm', ['exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]), ...browserFiles])
    : Effect.succeed(false);
  const sourceDone = yield* Deferred.make<void>();
  const sourceTests = nodeSuite('Source Node', sourceFiles, false).pipe(Effect.ensuring(Deferred.succeed(sourceDone, undefined)));
  const installedTests = Effect.gen(function*() {
    if ((!browserOnly && installedFiles.length > 0) || (values.suite !== 'node' && browserFiles.length > 0)) yield* awaitPackage();
    // Each official runner owns the complete Node file budget. Browser workers
    // may overlap either group, but two Node runners must never multiply it.
    const installedNode = Deferred.await(sourceDone).pipe(Effect.andThen(nodeSuite('Installed Node', installedFiles, true)));
    return (yield* Effect.all([installedNode, browserTests], { concurrency: 'unbounded' })).some(Boolean);
  }).pipe(Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return true; })));
  const failures = yield* Effect.all([sourceTests, installedTests], { concurrency: 'unbounded' });
  if (split) {
    const Timing = Schema.Struct({ file: Schema.String, duration_ms: Schema.Number, success: Schema.Boolean, cases: Schema.optional(Schema.Number) });
    const timings = [];
    for (const group of ['node-source', 'node-installed']) {
      const path = join(output, group, 'file-timings.json');
      if (yield* fs.exists(path)) timings.push(...yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timing)))(yield* fs.readFileString(path)));
    }
    yield* fs.writeFileString(join(output, 'file-timings.json'), `${JSON.stringify(timings.sort((left, right) => right.duration_ms - left.duration_ms), null, 2)}\n`);
  } else if (browserOnly || nodeFiles.length === 0) {
    yield* fs.writeFileString(join(output, 'file-timings.json'), '[]\n');
  }
  const Timing = Schema.Struct({ file: Schema.String, duration_ms: Schema.Number, success: Schema.Boolean, cases: Schema.optional(Schema.Number) });
  const timings = [];
  for (const path of [join(output, 'file-timings.json'), join(output, 'e2e', 'file-timings.json')]) {
    if (yield* fs.exists(path)) timings.push(...yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timing)))(yield* fs.readFileString(path)));
  }
  const layers = summarizeTestLayers(files, timings);
  yield* fs.writeFileString(join(output, 'layer-timings.json'), `${JSON.stringify(layers, null, 2)}\n`);
  yield* Effect.sync(() => {
    for (const row of layers) console.error(`# Gate layer ${row.layer}: files=${row.files}; timedFiles=${row.timedFiles}; cases=${row.cases}; countedFiles=${row.countedFiles}; ${(row.duration_ms / 1000).toFixed(3)}s (sum of file durations)`);
  });
  yield* Effect.sync(() => { process.exitCode = failures.some(Boolean) ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
