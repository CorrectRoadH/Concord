// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { availableParallelism, loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runNodeTests } from './test-reporter.js';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}

const main = Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const concurrency = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Concurrency)(process.env.CONCORD_TEST_CONCURRENCY ?? String(Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2))))),
    catch: cause => new TestArgumentsInvalid({ detail: `CONCORD_TEST_CONCURRENCY: ${String(cause)}` }),
  });
  const browserConcurrency = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Concurrency)(process.env.CONCORD_E2E_WORKERS ?? String(Math.min(4, concurrency))),
    catch: cause => new TestArgumentsInvalid({ detail: `CONCORD_E2E_WORKERS: ${String(cause)}` }),
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
  const nodeFiles = positionals.filter(file => file.endsWith('.test.ts'));
  const browserFiles = positionals.filter(file => file.endsWith('.e2e.ts'));
  if (values['node-worker']) {
    const output = process.env.CONCORD_NODE_OUTPUT;
    if (output === undefined) return yield* new TestArgumentsInvalid({ detail: 'Node worker requires CONCORD_NODE_OUTPUT' });
    const failed = yield* runNodeTests({
      ...(positionals.length ? { files: nodeFiles.map(file => resolve(file)) } : { globPatterns: ['test/**/*.test.ts'] }),
      isolation: 'process', concurrency, shard,
      testNamePatterns: values['test-name-pattern'],
      timeout: Duration.toMillis(Duration.minutes(5)),
      execArgv: ['--import', import.meta.resolve('tsx')],
    }, output);
    yield* Effect.sync(() => { process.exitCode = failed ? 1 : 0; });
    return;
  }
  const started = performance.now();
  yield* fs.makeDirectory('.test-results', { recursive: true });
  const output = resolve(yield* fs.makeTempDirectory({ directory: '.test-results', prefix: 'run-' }));
  // Compiled modules may be reused within this gate, never test verdicts.
  const compileCache = process.env.CONCORD_TEST_COMPILE_CACHE ?? join(output, 'node-compile-cache');
  if (process.env.CONCORD_TEST_COMPILE_CACHE === undefined) yield* Effect.addFinalizer(() => fs.remove(compileCache, { recursive: true, force: true }).pipe(Effect.orDie));
  const env = { ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=concord-source --import ${JSON.stringify(import.meta.resolve('tsx'))} --import ${JSON.stringify(new URL('../test/support/source-runtime.ts', import.meta.url).href)}`,
    NODE_COMPILE_CACHE: compileCache, CONCORD_TEST_COMPILE_CACHE: compileCache,
    // A nested runner is a new parent, not an official isolated test child.
    NODE_TEST_CONTEXT: undefined,
    CONCORD_NODE_OUTPUT: output,
    CONCORD_E2E_OUTPUT: join(output, 'e2e'), E2E_TELEMETRY_DISABLED: '1',
    CONCORD_E2E_AGENT: values.suite === 'agent' ? '1' : '0' };
  yield* Effect.sync(() => console.error(`# Source tests prepared in ${(performance.now() - started).toFixed(0)}ms; Node concurrency=${concurrency}; e2e workers=${browserConcurrency}\n# Test diagnostics: ${output}\n# Machine load: ${loadavg().map(value => value.toFixed(2)).join(', ')}; CPUs=${availableParallelism()}`));
  const suite = Effect.fn('test.suite')(function*(name: string, executable: string, args: string[]) {
    const suiteStarted = performance.now();
    const code = yield* Effect.scoped(Effect.gen(function*() {
      const child = yield* spawner.spawn(ChildProcess.make(executable, args, {
        env, detached: process.platform !== 'win32', forceKillAfter: Duration.seconds(5),
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
  const nodeTests = !browserOnly && (positionals.length === 0 || nodeFiles.length > 0)
    ? suite('Node', process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), '--node-worker', ...process.argv.slice(2)])
    : Effect.succeed(false);
  const browserTests = values.suite !== 'node' && (positionals.length === 0 || browserFiles.length > 0)
    ? suite('Browser', 'pnpm', ['exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]), ...browserFiles])
    : Effect.succeed(false);
  const failures = yield* Effect.all([nodeTests, browserTests], { concurrency: 'unbounded' });
  yield* Effect.sync(() => { process.exitCode = failures.some(Boolean) ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
