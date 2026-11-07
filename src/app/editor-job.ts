import { RuntimeEnvironment } from '../base/environment/index.ts';
import { workerEntryArgv } from "../base/installation/index.ts";
import { Deferred, Effect } from "effect";
import { OwnedProcess, makeOwnedProcessService, residentMemory, type OwnedProcessService } from "../base/process/index.ts";
import { ConcordError, failure } from "../model/index.ts";
import * as P from '../model/editor/index.ts';


/** Each invocation owns its service, including its completed-output history. */
export const runEditorJob = Effect.fn('editor.runJob')(function*(job: P.Job, cleanupFailed: (error: ConcordError) => void, providedService?: OwnedProcessService) {
  const service = providedService ?? makeOwnedProcessService({ environment: yield* RuntimeEnvironment });
  if (process.platform === 'win32') return yield* Effect.fail(new ConcordError('EditorTaskFailed', 'Editor computation requires owned POSIX process groups'));
  const input = yield* Effect.try({ try: () => JSON.stringify(job), catch: failure });
  if (Buffer.byteLength(input) > P.editorLimits.input) return yield* Effect.fail(new ConcordError('EditorBudgetExceeded', 'Job input limit'));
  let attempted = false;
  const work = Effect.gen(function*() {
    const owner = yield* OwnedProcess;
    const started = yield* Deferred.make<number>();
    const memory = Effect.gen(function*() {
      const pid = yield* Deferred.await(started);
      while (true) {
        const bytes = yield* residentMemory(pid).pipe(Effect.mapError(error => new ConcordError('EditorTaskFailed', error.detail)));
        if (bytes !== undefined && bytes > 256 * 1024 * 1024) return yield* Effect.fail(new ConcordError('EditorBudgetExceeded', 'Editor resident memory limit'));
        yield* Effect.sleep('100 millis');
      }
    });
    attempted = true;
    const result = yield* owner.run([process.execPath, ...workerEntryArgv('editor-worker'), service.environment.cwd], {
      cwd: job.root, stdin: input, timeoutMs: P.editorLimits.timeout, outputLimitBytes: P.editorLimits.output,
      stream: { ready: (_write, _end, identity) => { if (identity.pid !== undefined) Deferred.doneUnsafe(started, Effect.succeed(identity.pid)); }, stdout: () => {} },
    }).pipe(Effect.mapError(error => new ConcordError('EditorTaskFailed', error.detail)), Effect.raceFirst(memory));
    if (result.timedOut || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('EditorBudgetExceeded', result.timedOut ? 'Computation timeout' : 'Computation output limit'));
    if (result.exitCode !== 0 || result.signal !== null || result.cancelled || result.error !== undefined) return yield* Effect.fail(new ConcordError('EditorTaskFailed', result.error ?? 'Computation did not finish normally'));
    return yield* Effect.try({ try: () => {
      const reply = P.workerReply(JSON.parse(result.stdout));
      if (!reply.ok) throw new ConcordError(reply.code, reply.message);
      return reply.result;
    }, catch: failure });
  }).pipe(Effect.provideService(OwnedProcess, service));
  return yield* Effect.uninterruptibleMask(restore => Effect.gen(function*() {
    const outcome = yield* Effect.exit(restore(Effect.scoped(work)));
    // Scope finalizers have finished even when the request was interrupted.
    const records = yield* service.cleanupResults;
    if (attempted && (records.length === 0 || records.some(result => !result.processGroupOwned || !result.groupCleanup.owned || !result.groupCleanup.checked || result.groupCleanup.gone !== true))) {
      const error = new ConcordError('EditorTaskFailed', 'Computation process-group cleanup could not be confirmed');
      cleanupFailed(error);
      return yield* Effect.fail(error);
    }
    return yield* outcome;
  }));
});
