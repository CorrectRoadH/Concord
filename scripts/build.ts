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
  yield* fs.remove('dist', { recursive: true, force: true });
  const nativeArgs = ['--import', 'tsx', 'scripts/build-native.ts', '--output', 'dist/native'];
  const prebuilt = process.env.CONCORD_NATIVE_ARTIFACTS;
  if (prebuilt !== undefined) nativeArgs.push('--prebuilt', prebuilt);
  if (process.env.CONCORD_REQUIRE_PORTABLE_NATIVE === '1') nativeArgs.push('--require-portable');
  const nativeExit = yield* spawner.exitCode(ChildProcess.make(process.execPath, nativeArgs, { stdout: 'inherit', stderr: 'inherit' }));
  if (nativeExit !== 0) return yield* new BuildFailed({ project: 'hawdb-native', exitCode: nativeExit });
  for (const project of ['tsconfig.json', 'tsconfig.repository.json', 'tsconfig.web.json']) {
    const exitCode = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/typescript/bin/tsc', '-p', project], { stdout: 'inherit', stderr: 'inherit' }));
    if (exitCode !== 0) return yield* new BuildFailed({ project, exitCode });
  }
  const webExit = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdout: 'inherit', stderr: 'inherit' }));
  if (webExit !== 0) return yield* new BuildFailed({ project: 'web', exitCode: webExit });
  yield* fs.copyFile('node_modules/@fontsource-variable/noto-sans-sc/LICENSE', 'dist/web/FONT-LICENSE.txt');
  yield* fs.remove('dist/repository/host-types', { recursive: true, force: true });
  yield* fs.copy('repository/host-types', 'dist/repository/host-types');
  yield* fs.chmod('dist/entry.js', 0o755);
  yield* fs.chmod('dist/cli.js', 0o755);
});

build.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
