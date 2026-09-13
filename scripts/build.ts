import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

class BuildFailed extends Schema.TaggedError<BuildFailed>()('BuildFailed', {
  project: Schema.String,
  exitCode: Schema.Number,
}) {}

const build = Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  for (const project of ['tsconfig.json', 'tsconfig.repository.json']) {
    const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project], { stdout: 'inherit', stderr: 'inherit' }));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  }
  yield* fs.remove('dist/repository/host-types', { recursive: true, force: true });
  yield* fs.copy('repository/host-types', 'dist/repository/host-types');
  yield* fs.chmod('dist/entry.js', 0o755);
  yield* fs.chmod('dist/cli.js', 0o755);
});

build.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
