import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

export const BuildIdentity = Schema.Struct({
  format: Schema.Literal('concord.build-source/v1'),
  commit: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)),
  dirty: Schema.Boolean,
});
export type BuildIdentity = typeof BuildIdentity.Type;

export const captureBuildSource = Effect.fn('build.captureSource')(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const commit = (yield* spawner.string(ChildProcess.make('git', ['rev-parse', 'HEAD']))).trim();
  const dirty = (yield* spawner.string(ChildProcess.make('git', ['status', '--porcelain']))).trim() !== '';
  return yield* Schema.decodeUnknownEffect(BuildIdentity)({ format: 'concord.build-source/v1', commit, dirty });
});

export const writeBuildIdentity = Effect.fn('build.writeIdentity')(function*(start: BuildIdentity) {
  const end = yield* captureBuildSource();
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString('dist/build-identity.json', JSON.stringify({ ...start, dirty: start.dirty || end.dirty || start.commit !== end.commit }) + '\n');
});
