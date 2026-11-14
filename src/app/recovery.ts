import { RuntimeEnvironment } from '../base/environment/index.ts';
import { openWriteRepository } from "../base/workspace/index.ts";
import * as recovery from "../base/publication/index.ts";
import { Sources } from '../base/sources/index.ts';
import { join } from "node:path";
import { Effect } from "effect";
import { genericPrivateDirectorySync, recoverPublicationLeaseSync, Publication } from "../base/publication/index.ts";
import { CoordinationError } from "../base/publication/index.ts";
import { ConcordError, failure } from "../model/index.ts";
import { assertCurrentRuntimeFormat, discoverRoot } from "../base/workspace/index.ts";
import { inspectObservationSlot } from "../base/publication/index.ts";


export const pendingJournals = Effect.fn('recovery.pendingJournals')(function*(root: string) {
  const runtime = yield* RuntimeEnvironment;
  const privateDir = yield* Effect.try({ try: () => genericPrivateDirectorySync(root, runtime.env), catch: recoveryFailure });
  return yield* (yield* Sources).pendingPublications(privateDir, false).pipe(Effect.mapError(recoveryFailure));
});


export function recoveryFailure(cause: unknown): ConcordError {
  if (cause instanceof CoordinationError) {
    const code = cause.message.includes('busy') ? 'RepositoryBusy' : 'CoordinationFailed';
    return new ConcordError(code, cause.message, { operation: cause.operation, phase: cause.phase, path: cause.path });
  }
  if (cause instanceof Error && '_tag' in cause && cause._tag === 'TraceMutationError' && 'phase' in cause && cause.phase === 'lock' && cause.message.includes('busy')) {
    return new ConcordError('RepositoryBusy', cause.message);
  }
  return failure(cause);
}


/** Reclaim once, then select and recheck journals under each short lease.
 * Engines must not silently reclaim an owner that arrived after dispatch. */
export const recoverLocalState = Effect.fn('recoverLocalState')(function*(input?: string, releaseObservationSlot?: string) {
  const runtime = yield* RuntimeEnvironment;
  const publication = yield* Publication;
  const initial = yield* Effect.try({ try: () => {
    const root = discoverRoot(input, false, runtime);
    assertCurrentRuntimeFormat(root, genericPrivateDirectorySync(root, runtime.env));
    const reclaimedTokens = recoverPublicationLeaseSync(root, runtime.env);
    return { root, reclaimedTokens, privateDir: genericPrivateDirectorySync(root, runtime.env) };
  }, catch: recoveryFailure });
  const selected = yield* Effect.scoped(Effect.gen(function*() {
    yield* publication.lease(initial.root, 'recover-dispatch', true, false);
    const pending = yield* pendingJournals(initial.root);
    return yield* Effect.try({ try: () => {
      if (pending.length > 1) throw new ConcordError('RecoveryConflict', 'Multiple publication journals exist; preserve the conflicting recovery state');
      if (releaseObservationSlot !== undefined) recovery.releaseObservationSlot(initial.root, releaseObservationSlot, runtime.env);
      return { ...initial, trace: pending.length === 1 && pending[0] !== join(initial.privateDir, 'journal.json'), pending: pending.length > 0, observationSlot: inspectObservationSlot(initial.root, runtime.env) };
    }, catch: recoveryFailure });
  }));
  const completion = yield* Effect.gen(function*() {
    if (selected.trace) {
      const receipt = yield* (recovery.recoverTrace(selected.root, { reclaimPublication: false }) as Effect.Effect<unknown, unknown, RuntimeEnvironment>).pipe(Effect.mapError(recoveryFailure));
      return { operation: 'recover', status: 'trace-recovered', journalStatus: 'trace-recovered', changedPaths: [], warnings: [], receipt };
    }
    return yield* Effect.scoped(Effect.acquireUseRelease(
      openWriteRepository(selected.root, { recover: true, reclaimPublication: false }),
      repo => Effect.tryPromise({ try: async () => (await repo.recover()), catch: failure }).pipe(Effect.uninterruptible),
      repo => Effect.sync(() => repo.close()),
    ));
  });
  const observationSlot = yield* Effect.scoped(Effect.gen(function*() {
    yield* publication.lease(selected.root, 'recover-verify', true, false);
    yield* Effect.try({ try: () => assertCurrentRuntimeFormat(selected.root, genericPrivateDirectorySync(selected.root, runtime.env)), catch: recoveryFailure });
    if ((yield* pendingJournals(selected.root)).length > 0) return yield* Effect.fail(new ConcordError('RecoveryRequired', 'A publication journal remains after recovery; preserve it and retry recovery'));
    return yield* Effect.try({ try: () => inspectObservationSlot(selected.root, runtime.env), catch: recoveryFailure });
  }));
  return {
    ...completion,
    status: observationSlot.status === 'blocked' ? 'blocked' : completion.status,
    journalStatus: completion.journalStatus ?? completion.status,
    warnings: completion.warnings ?? [],
    observationSlot: releaseObservationSlot !== undefined && observationSlot.status === 'absent' ? { status: 'released', token: releaseObservationSlot } : observationSlot,
    coordination: { publication: { reclaimedTokens: selected.reclaimedTokens }, observationSlot },
  };
});
