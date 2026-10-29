import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parseArgs } from 'node:util';
import { packConcord } from './release-package.js';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
class TestArgumentsInvalid extends Schema.TaggedError<TestArgumentsInvalid>()('TestArgumentsInvalid', {
  detail: Schema.String,
}) {}

const main = Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const concurrency = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(Concurrency)(process.env.CONCORD_TEST_CONCURRENCY ?? '1'),
    catch: cause => new TestArgumentsInvalid({ detail: `CONCORD_TEST_CONCURRENCY: ${String(cause)}` }),
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
  const nodeOptions = Object.entries(values).filter(([name]) => name !== 'suite').map(([name, value]) => `--${name}=${value}`);
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
  const env = { ...process.env, CONCORD_TEST_ARTIFACT: manifest,
    CONCORD_TEST_FAILURES: join(output, 'node-failures.jsonl'),
    CONCORD_TEST_TIMINGS: process.env.CONCORD_TEST_TIMINGS ?? join(output, 'node-timings.jsonl'),
    CONCORD_E2E_OUTPUT: join(output, 'e2e'), E2E_TELEMETRY_DISABLED: '1',
    CONCORD_E2E_AGENT: values.suite === 'agent' ? '1' : '0' };
  yield* Effect.sync(() => console.error(`# Packed test artifact in ${(performance.now() - started).toFixed(0)}ms; concurrency=${concurrency}\n# Test diagnostics: ${output}`));
  const nodeFiles = files.filter(file => file.endsWith('.test.ts'));
  const browserFiles = files.filter(file => file.endsWith('.e2e.ts'));
  let failed = false;
  if (nodeFiles.length) {
    const code = yield* spawner.exitCode(ChildProcess.make(process.execPath, [
      '--import', 'tsx', '--test', `--test-concurrency=${concurrency}`, '--test-timeout=300000',
      '--test-reporter=./scripts/test-reporter.ts', ...nodeOptions, ...nodeFiles,
    ], { env, stdout: 'inherit', stderr: 'inherit' }));
    failed ||= Number(code) !== 0;
  }
  if (browserFiles.length) {
    const options = [
      ...(values.suite === 'agent' ? ['--tag', 'journey'] : []),
      ...(values['test-name-pattern'] === undefined ? [] : ['--grep', values['test-name-pattern']]),
      ...(values['test-shard'] === undefined ? [] : ['--shard', values['test-shard']]),
    ];
    const code = yield* spawner.exitCode(ChildProcess.make('pnpm', [
      'exec', 'e2e', 'run', '--config', values.suite === 'agent' ? 'e2e.agent.config.ts' : 'e2e.config.ts', '--no-cache', '--workers', String(concurrency),
      ...options, ...browserFiles,
    ], { env, stdout: 'inherit', stderr: 'inherit' }));
    failed ||= Number(code) !== 0;
  }
  yield* Effect.sync(() => { process.exitCode = failed ? 1 : 0; });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
