// @concord-file
// @concord-implements docs/engineering/testing/README.md#共享资源与同步
import { Effect } from 'effect';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquireRecoverablePublicationLease, CoordinationError, readLeaseOwner, releaseFileLease } from '../src/base/publication/file-lease.ts';

/** The supervisor owns the machine slot; a systemd re-exec keeps that owner. */
export const withGateQueue = <A, E, R>(body: Effect.Effect<A, E, R>, directory = process.env.CONCORD_GATE_QUEUE_DIRECTORY ?? join(homedir(), '.cache/concord/gate-queue')) => Effect.scoped(Effect.gen(function*() {
  const started = performance.now();
  let reportedOwner: string | undefined;
  const acquire = Effect.gen(function*() {
    for (;;) {
      const lease = yield* Effect.try({
        try: () => acquireRecoverablePublicationLease(resolve(directory), resolve(directory), 'publication.lease', 'exclusive', 'gate-queue')!,
        catch: cause => cause,
      }).pipe(Effect.catch(cause => cause instanceof CoordinationError && cause.reason === 'occupied' ? Effect.succeed(undefined) : Effect.fail(cause)));
      if (lease) return lease;
      const owner = yield* Effect.try({ try: () => readLeaseOwner(join(directory, 'publication.lease'), 'gate-queue'), catch: cause => cause });
      if (owner && owner.token !== reportedOwner) {
        reportedOwner = owner.token;
        yield* Effect.sync(() => console.error(`# Gate queued: waiting for pid=${owner.pid} host=${owner.host}; slot=${directory}`));
      }
      yield* Effect.sleep('50 millis');
    }
  });
  yield* Effect.acquireRelease(acquire, lease => Effect.sync(() => releaseFileLease(lease, 'gate-queue')));
  const waitMs = performance.now() - started;
  yield* Effect.sync(() => {
    process.env.CONCORD_GATE_QUEUE_WAIT_MS = String(waitMs);
    console.error(`# Gate queue wait: ${(waitMs / 1000).toFixed(3)}s; excluded from gate wallclock`);
  });
  return yield* body;
}));
