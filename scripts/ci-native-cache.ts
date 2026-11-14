// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#ci-任务
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { makeRuntimeEnvironment } from '../src/base/environment/index.ts';
import { HAWDB_VERSION, hawdbTarget, nativeCacheRoot, readNativeRelease } from '../src/base/installation/index.ts';

class NativeCacheOutputsFailed extends Schema.TaggedError<NativeCacheOutputsFailed>()('NativeCacheOutputsFailed', { message: Schema.String }) {}

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const destination = process.env.GITHUB_OUTPUT;
  if (!destination) return yield* new NativeCacheOutputsFailed({ message: 'GITHUB_OUTPUT is required' });
  const outputs = yield* Effect.try({
    try: () => ({
      key: `native-artifact-v3-${hawdbTarget()}-${HAWDB_VERSION}-${readNativeRelease().tag}`,
      directory: nativeCacheRoot(makeRuntimeEnvironment(process.cwd(), process.env)),
    }),
    catch: cause => new NativeCacheOutputsFailed({ message: String(cause) }),
  });
  if (Object.values(outputs).some(value => /[\r\n]/u.test(value))) return yield* new NativeCacheOutputsFailed({ message: 'Native cache outputs must be single-line values' });
  yield* fs.writeFileString(destination, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''), { flag: 'a' });
});

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
