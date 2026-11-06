// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initializeNodeCompileCache } from '../src/base/installation/startup/index.ts';
import { runNodeTests } from './test-reporter.ts';
import { currentGateMemoryMax, gateConcurrency } from './gate-resources.ts';
import { auditTestLayers, summarizeTestLayers } from './test-layers.ts';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}
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
  const runnerFlags = [
    ...(values['test-name-pattern'] === undefined ? [] : [`--test-name-pattern=${values['test-name-pattern']}`]),
    ...(values['test-shard'] === undefined ? [] : [`--test-shard=${values['test-shard']}`]),
  ];
  const nodeTests = !browserOnly && nodeFiles.length > 0
    ? suite('Source Node', process.execPath, [fileURLToPath(import.meta.url), '--node-worker', '--suite=node', ...runnerFlags, ...nodeFiles], {
      ...env, CONCORD_NODE_OUTPUT: output, CONCORD_TEST_PACKAGE_ROOT: undefined, CONCORD_TEST_PACKAGE_BUILD_STATUS: undefined,
    }) : Effect.succeed(false);
  const browserTests = values.suite !== 'node' && browserFiles.length > 0
    ? suite('Browser', 'pnpm', ['exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]), ...browserFiles])
    : Effect.succeed(false);
  const failures = yield* Effect.all([nodeTests, browserTests], { concurrency: 'unbounded' });
  if (browserOnly || nodeFiles.length === 0) yield* fs.writeFileString(join(output, 'file-timings.json'), '[]\n');
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
