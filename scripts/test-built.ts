import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packConcord } from './release-package.js';

const Concurrency = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));

const main = Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const concurrency = yield* Effect.try(() => Schema.decodeUnknownSync(Concurrency)(process.env.CONCORD_TEST_CONCURRENCY ?? '4'));
  const scratch = yield* Effect.acquireRelease(
    fs.makeTempDirectory({ directory: tmpdir(), prefix: 'concord-test-run-' }),
    path => fs.remove(path, { recursive: true, force: true }).pipe(Effect.orDie),
  );
  const started = performance.now();
  const artifact = yield* Effect.sync(() => packConcord(scratch));
  const manifest = join(scratch, 'artifact.json');
  yield* fs.writeFileString(manifest, JSON.stringify(artifact));
  yield* Effect.sync(() => console.error(`# Packed test artifact in ${(performance.now() - started).toFixed(0)}ms; concurrency=${concurrency}`));
  const args = process.argv.slice(2);
  const files = args.length === 0
    ? (yield* fs.readDirectory('test')).filter(name => name.endsWith('.test.ts')).sort().map(name => join('test', name))
    : args;
  const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, [
    '--import', 'tsx', '--test', `--test-concurrency=${concurrency}`,
    '--test-reporter=./scripts/test-reporter.ts', ...files,
  ], { env: { ...process.env, CONCORD_TEST_ARTIFACT: manifest }, stdout: 'inherit', stderr: 'inherit' }));
  yield* Effect.sync(() => { process.exitCode = Number(exitCode); });
}));

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
