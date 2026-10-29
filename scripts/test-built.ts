import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { basename, join, resolve } from 'node:path';
import { availableParallelism, tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { TestCounts } from './test-reporter.js';
import { packConcord } from './release-package.js';

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
    } }),
    catch: cause => new TestArgumentsInvalid({ detail: String(cause) }),
  });
  if (!['all', 'node', 'e2e', 'agent'].includes(values.suite)) return yield* new TestArgumentsInvalid({ detail: `Unknown suite: ${values.suite}` });
  const browserOnly = values.suite === 'e2e' || values.suite === 'agent';
  const shard = yield* Effect.try({ try: () => {
    if (values['test-shard'] === undefined) return undefined;
    const raw = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[1-9]\d*\/[1-9]\d*$/u)))(values['test-shard']);
    const pair = Schema.decodeUnknownSync(Schema.Tuple([Concurrency, Concurrency]))(raw.split('/'));
    if (pair[0] > pair[1]) throw new Error('Shard index exceeds the shard count');
    return pair;
  }, catch: cause => new TestArgumentsInvalid({ detail: `--test-shard: ${String(cause)}` }) });
  const nodeOptions = Object.entries(values).filter(([name]) => name !== 'suite' && name !== 'test-shard').map(([name, value]) => `--${name}=${value}`);
  const files = positionals.length > 0 ? positionals : [
    ...(browserOnly ? [] : (yield* fs.readDirectory('test')).filter(name => name.endsWith('.test.ts')).sort().map(name => join('test', name))),
    ...(values.suite === 'node' ? [] : (yield* fs.readDirectory('test/e2e')).filter(name => name.endsWith('.e2e.ts')).sort().map(name => join('test/e2e', name))),
  ];
  for (const file of files) {
    if ((!file.endsWith('.test.ts') && !file.endsWith('.e2e.ts')) || !(yield* fs.exists(file))) {
      return yield* new TestArgumentsInvalid({ detail: `Not a test file: ${file}` });
    }
    if ((values.suite === 'node' && file.endsWith('.e2e.ts')) || (browserOnly && file.endsWith('.test.ts'))) {
      return yield* new TestArgumentsInvalid({ detail: `File does not belong to ${values.suite}: ${file}` });
    }
  }
  if (files.length === 0) return yield* new TestArgumentsInvalid({ detail: 'No test files selected' });
  const scratch = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: tmpdir(), prefix: 'concord-test-run-' }),
    path => fs.remove(path, { recursive: true, force: true }).pipe(Effect.orDie),
  );
  const started = performance.now();
  const artifact = yield* Effect.sync(() => packConcord(scratch));
  const manifest = join(scratch, 'artifact.json');
  yield* fs.writeFileString(manifest, JSON.stringify(artifact));
  yield* fs.makeDirectory('.test-results', { recursive: true });
  const output = resolve(yield* fs.makeTempDirectory({ directory: '.test-results', prefix: 'run-' }));
  const env = { ...process.env, CONCORD_TEST_ARTIFACT: manifest, CONCORD_TEST_INSTALLS: join(scratch, 'installs'),
    CONCORD_TEST_FAILURES: join(output, 'node-failures.jsonl'),
    CONCORD_TEST_TIMINGS: process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl'),
    CONCORD_E2E_OUTPUT: join(output, 'e2e'), E2E_TELEMETRY_DISABLED: '1',
    CONCORD_E2E_AGENT: values.suite === 'agent' ? '1' : '0' };
  yield* Effect.sync(() => console.error(`# Packed test artifact in ${(performance.now() - started).toFixed(0)}ms; Node concurrency=${concurrency}; e2e workers=${browserConcurrency}\n# Test diagnostics: ${output}`));
  const nodeFiles = [...new Set(files.filter(file => file.endsWith('.test.ts')).map(file => resolve(file)))].sort()
    .filter((_file, index) => shard === undefined || index % shard[1] === shard[0] - 1);
  const browserFiles = files.filter(file => file.endsWith('.e2e.ts'));
  let failed = false;
  if (nodeFiles.length) {
    const nodeStarted = performance.now();
    const logs = join(output, 'node');
    yield* fs.makeDirectory(logs);
    const results = yield* Effect.all(nodeFiles.map(file => Effect.gen(function*() {
      const id = createHash('sha256').update(file).digest('hex');
      const log = join(logs, `${basename(file)}-${id}.log`), summary = join(logs, `${id}.json`);
      const fileStarted = performance.now();
      const code = yield* Effect.scoped(Effect.gen(function*() {
        const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [
          '--import', 'tsx', '--test', '--test-isolation=none', '--test-concurrency=1', '--test-timeout=300000',
          '--test-reporter=./scripts/test-reporter.ts', ...nodeOptions, file,
        ], { env: { ...env, CONCORD_TEST_FILE: file, CONCORD_TEST_SUMMARY: summary },
          detached: process.platform !== 'win32', stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
        const [, exitCode] = yield* Effect.all([Stream.run(child.all, fs.sink(log)), child.exitCode], { concurrency: 'unbounded' });
        return Number(exitCode);
      })).pipe(Effect.catch(cause => Effect.sync(() => { console.error(`# Node file failed: ${file}: ${String(cause)}`); return 1; })));
      const text = (yield* fs.exists(log)) ? yield* fs.readFileString(log) : '';
      yield* Effect.sync(() => { console.error(`# Node file: ${file}; ${((performance.now() - fileStarted) / 1000).toFixed(3)}s; exit=${code}; log=${log}`); process.stdout.write(text); });
      const counts = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.fromJsonString(TestCounts), { onExcessProperty: 'error' })(readFileSync(summary, 'utf8')),
        catch: cause => new TestArgumentsInvalid({ detail: `Missing or invalid summary for ${file}: ${String(cause)}` }),
      }).pipe(Effect.catch(cause => Effect.sync(() => { console.error(cause.detail); return undefined; })));
      return { code, counts };
    })), { concurrency });
    const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 0, suites: 0 };
    for (const result of results) if (result.counts !== undefined) {
      for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts[key] += result.counts[key];
    }
    failed ||= results.some(result => result.code !== 0 || result.counts === undefined);
    const timing = { success: !failed, counts, duration_ms: performance.now() - nodeStarted, scope: 'run' };
    yield* Effect.sync(() => {
      appendFileSync(env.CONCORD_TEST_TIMINGS, `${JSON.stringify(timing)}\n`);
      console.error(`# Node total: ${JSON.stringify(timing)}\n# Node tests: ${(timing.duration_ms / 1000).toFixed(3)}s; exit=${failed ? 1 : 0}`);
    });
  }
  if (browserFiles.length) {
    const browserStarted = performance.now();
    const options = [
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]),
    ];
    const code = yield* spawner.exitCode(ChildProcess.make('pnpm', [
      'exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(browserConcurrency),
      ...options, ...browserFiles,
    ], { env, stdout: 'inherit', stderr: 'inherit' }));
    yield* Effect.sync(() => console.error(`# Browser tests: ${((performance.now() - browserStarted) / 1000).toFixed(3)}s; exit=${code}`));
    failed ||= Number(code) !== 0;
  }
  yield* Effect.sync(() => { process.exitCode = failed ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
