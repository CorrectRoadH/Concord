import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { fixtureConsumer } from '../../bench/fixtures/index.js';
import { defaultScale, pathConsumer, scaleConsumer, selfConsumer, type Consumer, type ScaleSpec } from './consumer.js';
import { mustRun, PerfError, refreshPids, settleRefreshes } from './process.js';

/** Temporary directories are canonical before any CLI observes them. */
export const workDirectory = Effect.fn('perf.workDirectory')(function*(prefix: string, keep: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const options = { directory: tmpdir(), prefix };
  const dir = yield* (keep ? fs.makeTempDirectory(options) : fs.makeTempDirectoryScoped(options));
  if (keep) yield* Effect.addFinalizer(() => Effect.sync(() => { process.stderr.write(`kept ${dir}\n`); }));
  return yield* fs.realPath(dir);
});
const Count = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const ScaleTuple = Schema.Tuple([Count, Count, Count]);
export function parseScale(value: string | undefined): ScaleSpec {
  if (value === undefined) return defaultScale;
  const [sources, tests, pages] = Schema.decodeUnknownSync(ScaleTuple)(value.split(','));
  return { sources, tests, pages };
}
const existingRefreshes = new WeakMap<Consumer, readonly number[]>();
export const settleConsumerRefreshes = (consumer: Consumer) => settleRefreshes(consumer.root, existingRefreshes.get(consumer) ?? []);

export const prepareConsumer = Effect.fn('perf.prepareConsumer')(function*(kind: string, options: {
  readonly smoke?: boolean; readonly repository: string; readonly commit: string; readonly entry: string; readonly scale: ScaleSpec; readonly workDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  // Register cleanup before initialization, including failed initialization.
  const root = kind.startsWith('fixture:') ? join(options.workDir, kind.slice(8)) : kind === 'self' || kind === 'scale' ? join(options.workDir, kind) : yield* fs.realPath(kind);
  const preexisting = yield* refreshPids(root);
  const serverRecord = join(root, '.git/concord/server/current.json');
  const hadServer = yield* fs.exists(serverRecord);
  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    if (!hadServer && (yield* fs.exists(serverRecord))) {
      yield* mustRun([process.execPath, options.entry, '--root', root, '--json', 'server', 'stop'], { cwd: root, outputDir: options.workDir });
      // Historical baselines can acknowledge stop before their cleanup finishes.
      yield* Effect.gen(function*() {
        while (yield* fs.exists(serverRecord)) yield* Effect.sleep('10 millis');
      }).pipe(Effect.timeout('10 seconds'), Effect.mapError(() => new PerfError({ message: `Consumer service did not stop: ${root}` })));
    }
    yield* settleRefreshes(root, preexisting);
  }).pipe(Effect.orDie));
  const consumer = yield* (kind.startsWith('fixture:') ? fixtureConsumer(kind.slice(8), options.entry, options.workDir, options.smoke, { repository: options.repository, commit: options.commit }) : kind === 'self' ? selfConsumer(options.repository, options.commit, options.workDir, options.entry, options.smoke)
    : kind === 'scale' ? scaleConsumer(options.entry, options.scale, options.workDir)
      : pathConsumer(kind, options.workDir));
  existingRefreshes.set(consumer, preexisting);
  return consumer;
});
