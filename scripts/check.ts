import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join } from 'node:path';
import { checkoutRoot } from './build-output.js';
import { tmpdir } from './test-temporary.js';

class DistInCheckout extends Schema.TaggedError<DistInCheckout>()('DistInCheckout', { message: Schema.String }) {}

class CheckFailed extends Schema.TaggedError<CheckFailed>()('CheckFailed', {
  phase: Schema.String,
  exitCode: Schema.Number,
}) {}

const command = Effect.fn('check.command')(function* (name: string, executable: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const started = performance.now();
  yield* Effect.sync(() => console.error(`# ${name}: starting`));
  const code = yield* spawner.exitCode(ChildProcess.make(executable, args, { stdout: 'inherit', stderr: 'inherit' }));
  yield* Effect.sync(() => console.error(`# ${name}: ${((performance.now() - started) / 1000).toFixed(3)}s; exit=${code}`));
  return Number(code);
});

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(join(checkoutRoot, 'dist'))) return yield* new DistInCheckout({ message: 'Delete dist/ from the checkout before running pnpm check. Tests run source; build packages with vp build --outDir <external-directory>.' });
  const compileCache = yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: 'concord-check-compile-' });
  yield* Effect.acquireRelease(Effect.sync(() => {
    const previous = { cache: process.env.NODE_COMPILE_CACHE, owner: process.env.CONCORD_TEST_COMPILE_CACHE };
    process.env.NODE_COMPILE_CACHE = compileCache;
    process.env.CONCORD_TEST_COMPILE_CACHE = compileCache;
    return previous;
  }), previous => Effect.sync(() => {
    if (previous.cache === undefined) delete process.env.NODE_COMPILE_CACHE;
    else process.env.NODE_COMPILE_CACHE = previous.cache;
    if (previous.owner === undefined) delete process.env.CONCORD_TEST_COMPILE_CACHE;
    else process.env.CONCORD_TEST_COMPILE_CACHE = previous.owner;
  }).pipe(Effect.andThen(fs.remove(compileCache, { recursive: true, force: true })), Effect.orDie));
  const started = performance.now();
  const staticChecks = Effect.gen(function*() {
    const staticStarted = performance.now();
    const checks = yield* Effect.all([
      ...['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json'].map(project =>
        command(project, process.execPath, ['node_modules/typescript/bin/tsc', '-p', project, '--noEmit'])),
      command('Selfhost', process.execPath, ['--import', 'tsx', 'src/entry/cli/entry.ts', '--json', '--dry-run', 'check']),
    ], { concurrency: 'unbounded' });
    yield* Effect.sync(() => console.error(`# Static checks: ${((performance.now() - staticStarted) / 1000).toFixed(3)}s`));
    return checks;
  });
  const [tests, checks] = yield* Effect.all([
    command('Tests (source)', process.execPath, ['--import', 'tsx', 'scripts/test-built.ts', ...process.argv.slice(2)]),
    staticChecks,
  ], { concurrency: 'unbounded' });
  yield* Effect.sync(() => {
    console.error(`# Check total: ${((performance.now() - started) / 1000).toFixed(3)}s`);
    process.exitCode = tests === 0 && checks.every(code => code === 0) ? 0 : 1;
  });
});

main.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
