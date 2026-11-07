// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md#contention
import { Clock, Effect, Result } from "effect";
import { ConcordError } from "../../model/index.ts";

/** Retry acquisition only, never replay an operation that may have published. */
export const waitForPublication = Effect.fn('waitForPublication')(function*<A, R>(acquire: (reclaimDead: boolean) => Effect.Effect<A, ConcordError, R>): Effect.fn.Return<A, ConcordError, R> {
  const deadline = (yield* Clock.currentTimeMillis) + 3000;
  let first = true;
  while (true) {
    const result = yield* Effect.result(acquire(first));
    first = false;
    if (Result.isSuccess(result)) return result.success;
    const error = result.failure;
    if (error.code !== 'RepositoryBusy' || !error.message.includes('publication lease is busy')) return yield* Effect.fail(error);
    // An already publishing owner is bounded by its own operation lifetime.
    // Reopening a read waits for that owner; acquisition-only contention keeps
    // its existing three-second limit and never replays a completed mutation.
    const publishing = typeof error.details === 'object' && error.details !== null && 'livePublication' in error.details && error.details.livePublication === true;
    if (!publishing && (yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.fail(new ConcordError('RepositoryBusy', `Timed out waiting for publication ownership (3000 ms). ${error.message}`, { coordination: error.details, waitedMs: 3000 }));
    }
    yield* Effect.sleep('50 millis');
  }
});
