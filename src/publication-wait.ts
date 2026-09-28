// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
import { Clock, Effect, Result } from 'effect';
import { ConcordError } from './shared.js';

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
    if ((yield* Clock.currentTimeMillis) >= deadline) {
      return yield* Effect.fail(new ConcordError('RepositoryBusy', `Timed out waiting for publication ownership (3000 ms). ${error.message}`, { coordination: error.details, waitedMs: 3000 }));
    }
    yield* Effect.sleep('50 millis');
  }
});
