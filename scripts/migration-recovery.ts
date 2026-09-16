import { lstatSync } from 'node:fs';
import { Effect } from 'effect';
import { genericJournalPath } from '../src/coordination.js';
import { ConcordError } from '../src/shared.js';
import { TraceRecoveryRequired } from '../repository/docs/trace/errors.js';

function blocked(path: string): ConcordError {
  return new ConcordError('MigrationRecoveryRequired', `A generic publication journal is pending at ${path}. Historical journals require independent, explicit offline recovery before migration. This migration does not recover journals. Preserve the transaction and locks; do not delete the recovery scene or repeatedly invoke ordinary recover.`, { path });
}

/** Refuse historical scenes before lease acquisition can create or chmod a lock. */
export function withMigrationJournalGuard<A, E, R>(root: string, operation: Effect.Effect<A, E, R>): Effect.Effect<A, Error, R> {
  return Effect.try({ try: () => {
      const path = genericJournalPath(root);
      try { lstatSync(path); }
      catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return;
        throw cause;
      }
      throw blocked(path);
    }, catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)) }).pipe(
    Effect.flatMap(() => operation),
    Effect.mapError((cause) => cause instanceof TraceRecoveryRequired && cause.nextStep === 'concord recover' ? blocked(cause.path) : cause instanceof Error ? cause : new Error(String(cause))),
  );
}
