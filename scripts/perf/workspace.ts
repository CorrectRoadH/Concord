import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { defaultScale, pathConsumer, scaleConsumer, selfConsumer, type Consumer, type ScaleSpec } from './consumer.js';
import { io, refreshPids, settleRefreshes } from './process.js';

/** Temporary directories are canonical before any CLI observes them. */
export const workDirectory = (prefix: string, keep: boolean) => Effect.acquireRelease(
  io('Create work directory', () => realpathSync(mkdtempSync(join(tmpdir(), prefix)))),
  dir => Effect.sync(() => { if (keep) process.stderr.write(`kept ${dir}\n`); else rmSync(dir, { recursive: true, force: true }); }),
);
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
  readonly repository: string; readonly commit: string; readonly entry: string; readonly scale: ScaleSpec; readonly workDir: string;
}) {
  // Register cleanup before initialization, including failed initialization.
  const root = kind === 'self' || kind === 'scale' ? join(options.workDir, kind) : yield* io('Resolve consumer path', () => realpathSync(kind));
  const preexisting = yield* refreshPids(root);
  yield* Effect.addFinalizer(() => settleRefreshes(root, preexisting).pipe(Effect.orDie));
  const consumer = yield* (kind === 'self' ? selfConsumer(options.repository, options.commit, options.workDir)
    : kind === 'scale' ? scaleConsumer(options.entry, options.scale, options.workDir)
      : pathConsumer(kind, options.workDir));
  existingRefreshes.set(consumer, preexisting);
  return consumer;
});
