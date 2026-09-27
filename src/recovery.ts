// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, CoordinationError, genericPrivateDirectorySync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from './coordination.js';
import { ConcordError, failure } from './shared.js';
import { assertCurrentRuntimeFormat, discoverRoot, LocalRepository } from './storage.js';
import { inspectRunner } from './run-coordination.js';

function pendingJournals(root: string): readonly string[] {
  const privateDir = genericPrivateDirectorySync(root), traceDir = tracePrivateDirectorySync(root);
  return [join(privateDir, 'journal.json'), join(traceDir, 'publication-journal.json'), join(traceDir, 'multi-file-publication-journal.json')]
    .filter(path => lstatSync(path, { throwIfNoEntry: false }) !== undefined);
}

function recoveryFailure(cause: unknown): ConcordError {
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
export const recoverLocalState = Effect.fn('recoverLocalState')(function*(input?: string) {
  const selected = yield* Effect.try({ try: () => {
    const root = discoverRoot(input);
    assertCurrentRuntimeFormat(root);
    const reclaimedTokens = recoverPublicationLeaseSync(root);
    const lease = acquireTraceLeaseSync(root, 'exclusive', 'recover-dispatch')!;
    try {
      const privateDir = genericPrivateDirectorySync(root);
      const pending = pendingJournals(root);
      if (pending.length > 1) throw new ConcordError('RecoveryConflict', 'Multiple publication journals exist; preserve the conflicting recovery state');
      return { root, trace: pending.length === 1 && pending[0] !== join(privateDir, 'journal.json'), pending: pending.length > 0, reclaimedTokens, runner: inspectRunner(root) };
    } finally { releaseTraceLeaseSync(lease, 'recover-dispatch'); }
  }, catch: recoveryFailure });
  if (selected.runner.status === 'blocked') return {
    operation: 'recover', status: 'blocked', journalStatus: selected.pending ? 'pending' : 'clean', changedPaths: [],
    coordination: { publication: { reclaimedTokens: selected.reclaimedTokens }, runner: selected.runner },
  };
  const completion = yield* Effect.gen(function*() {
    if (selected.trace) {
      // Repository code is built after the core CLI; retain the package-relative
      // runtime boundary rather than importing repository source into this build.
      const entry = './repository/docs/trace/relation-mutation.js';
      const recovery = yield* Effect.tryPromise({ try: () => import(entry), catch: failure });
      const receipt = yield* (recovery.recoverTrace(selected.root, { reclaimPublication: false }) as Effect.Effect<unknown, unknown>).pipe(Effect.mapError(recoveryFailure));
      return { operation: 'recover', status: 'trace-recovered', receipt };
    }
    return yield* Effect.acquireUseRelease(
      Effect.try({ try: () => new LocalRepository(selected.root, { recover: true, reclaimPublication: false }), catch: failure }),
      repo => Effect.try({ try: () => repo.recover(), catch: failure }),
      repo => Effect.sync(() => repo.close()),
    );
  });
  const runner = yield* Effect.try({ try: () => {
    const lease = acquireTraceLeaseSync(selected.root, 'exclusive', 'recover-verify')!;
    try {
      assertCurrentRuntimeFormat(selected.root);
      if (pendingJournals(selected.root).length > 0) throw new ConcordError('RecoveryRequired', 'A publication journal remains after recovery; preserve it and retry recovery');
      return inspectRunner(selected.root);
    } finally { releaseTraceLeaseSync(lease, 'recover-verify'); }
  }, catch: recoveryFailure });
  return { ...completion, status: runner.status === 'blocked' ? 'blocked' : completion.status, journalStatus: completion.status,
    coordination: { publication: { reclaimedTokens: selected.reclaimedTokens }, runner } };
});
