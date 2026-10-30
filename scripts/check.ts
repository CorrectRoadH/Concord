import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

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
  const started = performance.now();
  const sourceTests = yield* command('Source tests (architecture/model/domain)', process.execPath, ['--import', 'tsx', 'scripts/test-built.ts', '--suite=source', ...process.argv.slice(2)]);
  if (sourceTests !== 0) return yield* new CheckFailed({ phase: 'source tests', exitCode: sourceTests });
  const build = yield* command('Build', 'pnpm', ['exec', 'vp', 'build']);
  if (build !== 0) return yield* new CheckFailed({ phase: 'build', exitCode: build });
  const staticStarted = performance.now();
  const checks = yield* Effect.all([
    ...['tsconfig.json', 'tsconfig.test.json', 'tsconfig.scripts.json'].map(project =>
      command(project, process.execPath, ['node_modules/typescript/bin/tsc', '-p', project, '--noEmit'])),
    command('Selfhost', process.execPath, ['--import', 'tsx', 'src/entry/cli/entry.ts', '--json', '--dry-run', 'check']),
  ], { concurrency: 'unbounded' });
  yield* Effect.sync(() => console.error(`# Static checks: ${((performance.now() - staticStarted) / 1000).toFixed(3)}s`));
  if (checks.some(code => code !== 0)) return yield* new CheckFailed({ phase: 'static checks', exitCode: 1 });
  const tests = yield* command('Tests', process.execPath, ['--import', 'tsx', 'scripts/test-built.ts', '--suite=packed', ...process.argv.slice(2)]);
  yield* Effect.sync(() => {
    console.error(`# Check total: ${((performance.now() - started) / 1000).toFixed(3)}s`);
    process.exitCode = tests === 0 ? 0 : 1;
  });
});

main.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
