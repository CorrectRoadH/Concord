// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/inspect-writing.md
import { Effect, Result } from 'effect';
import { ConcordError, failure } from './shared.js';
import { LocalRepository } from './storage.js';
import { checkProject } from './project-check.js';
import { waitForPublication } from './publication-wait.js';

const sync = <A>(run: () => A) => Effect.try({ try: run, catch: failure });

/** Only this read-only operation may replay; every attempt owns a fresh repository. */
export const checkCurrentProject = Effect.fn('checkCurrentProject')(function*(root?: string, cache: 'use' | 'off' = 'use') {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = yield* Effect.result(Effect.gen(function*() {
      const repo = yield* Effect.acquireRelease(
        waitForPublication(reclaimPublication => sync(() => new LocalRepository(root, { access: 'read', reclaimPublication }))),
        repo => Effect.sync(() => repo.close()),
      );
      yield* Effect.acquireRelease(
        waitForPublication(reclaimDead => sync(() => repo.beginSnapshot(reclaimDead))),
        () => Effect.sync(() => repo.endSnapshot()),
      );
      return yield* sync(() => {
        let report: ReturnType<typeof checkProject>;
        try { report = checkProject(repo, cache); }
        catch (cause) {
          if (cause instanceof ConcordError && ['UnsafePath', 'RecoveryRequired', 'InvalidFile', 'ReadOnlyRepository'].includes(cause.code)) throw cause;
          repo.verifySnapshot();
          throw cause;
        }
        repo.verifySnapshot();
        if (report.findings.some(finding => finding.code === 'SourceChanged')) throw new ConcordError('SourceChanged', 'A reference changed during check');
        return report;
      });
    }).pipe(Effect.scoped));
    if (Result.isSuccess(result)) return result.success;
    const error = result.failure;
    if (error.code !== 'SourceChanged' && !(error.code === 'PreimageChanged' && error.details === 'source-observation')) return yield* Effect.fail(error);
    if (attempt === 3) return yield* Effect.fail(new ConcordError('SourceChanged', 'Check could not obtain stable current inputs after 3 attempts; editing is still in progress. Retry when the files settle.', { attempts: 3, complete: false }));
    yield* Effect.sleep('50 millis');
  }
  return yield* Effect.fail(new ConcordError('SourceChanged', 'Check did not complete'));
});
