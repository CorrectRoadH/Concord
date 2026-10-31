import { Effect } from 'effect';
import { acquireBuildLock } from './build-lock.js';
import { io, mustRun } from './perf/process.js';

/** The caller's scope owns the lease through its final sample and cleanup. */
export const buildForMeasurement = Effect.fn('perf.buildForMeasurement')(function*(root: string, outputDir: string, lockPort?: number) {
  const lock = yield* Effect.acquireRelease(acquireBuildLock(undefined, lockPort), active => Effect.promise(active.release));
  yield* Effect.acquireRelease(Effect.sync(() => {
    const previous = process.env.CONCORD_BUILD_LOCK;
    process.env.CONCORD_BUILD_LOCK = lock.token;
    return previous;
  }), previous => Effect.sync(() => {
    if (previous === undefined) delete process.env.CONCORD_BUILD_LOCK;
    else process.env.CONCORD_BUILD_LOCK = previous;
  }));
  const built = yield* mustRun(['pnpm', 'exec', 'vp', 'build'], { cwd: root, outputDir });
  yield* io('Report candidate build', () => process.stderr.write(built.stdout + built.stderr));
});
