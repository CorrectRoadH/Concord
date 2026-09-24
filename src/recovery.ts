// @concord-file
// @concord-implements docs/feature/portable-coordination/use-case/coordinate-local-publications.md
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { acquireTraceLeaseSync, CoordinationError, genericPrivateDirectorySync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync } from './coordination.js';
import { ConcordError, failure } from './shared.js';
import { assertCurrentRuntimeFormat, discoverRoot, LocalRepository } from './storage.js';

function recoveryFailure(cause: unknown): ConcordError {
  if (cause instanceof CoordinationError) {
    const code = cause.message.includes('busy') ? 'RepositoryBusy' : 'CoordinationFailed';
    return new ConcordError(code, cause.message, { operation: cause.operation, phase: cause.phase, path: cause.path });
  }
  return failure(cause);
}

/** Dispatch is read-only. Each selected recovery rechecks its journals under its
 * own lease, so a concurrent recovery between selection and entry cannot grant
 * stale authorization or cause the other journal kind to be ignored. */
export const recoverLocalState = Effect.fn('recoverLocalState')(function*(input?: string) {
  const selected = yield* Effect.try({ try: () => {
    const root = discoverRoot(input);
    assertCurrentRuntimeFormat(root);
    recoverPublicationLeaseSync(root);
    const lease = acquireTraceLeaseSync(root, 'exclusive', 'recover-dispatch')!;
    try {
      const privateDir = genericPrivateDirectorySync(root);
      const traceDir = tracePrivateDirectorySync(root);
      const journals = [join(privateDir, 'journal.json'), join(traceDir, 'publication-journal.json'), join(traceDir, 'multi-file-publication-journal.json')];
      const pending = journals.filter(path => lstatSync(path, { throwIfNoEntry: false }) !== undefined);
      if (pending.length > 1) throw new ConcordError('RecoveryConflict', 'Multiple publication journals exist; preserve the conflicting recovery state');
      return { root, trace: pending.length === 1 && pending[0] !== journals[0] };
    } finally { releaseTraceLeaseSync(lease, 'recover-dispatch'); }
  }, catch: recoveryFailure });
  if (selected.trace) {
    // Repository code is built after the core CLI; retain the package-relative
    // runtime boundary rather than importing repository source into this build.
    const entry = './repository/docs/trace/relation-mutation.js';
    const recovery = yield* Effect.tryPromise({ try: () => import(entry), catch: failure });
    const receipt = yield* (recovery.recoverTrace(selected.root) as Effect.Effect<unknown, unknown>).pipe(Effect.mapError(failure));
    return { operation: 'recover', status: 'trace-recovered', receipt };
  }
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: () => new LocalRepository(selected.root, { recover: true }), catch: failure }),
    repo => Effect.try({ try: () => repo.recover(), catch: failure }),
    repo => Effect.sync(() => repo.close()),
  );
});
