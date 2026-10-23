// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md#文件与资源边界
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { OwnedProcess, makeOwnedProcessService, type OwnedProcessService } from './owned-process.js';
import { ConcordError, failure } from './shared.js';
import * as P from './editor-protocol.js';

/** Each invocation owns its service, including its completed-output history. */
export const runEditorJob = Effect.fn('editor.runJob')(function*(job: P.Job, cleanupFailed: (error: ConcordError) => void, service: OwnedProcessService = makeOwnedProcessService()) {
  if (process.platform === 'win32') return yield* Effect.fail(new ConcordError('EditorTaskFailed', 'Editor computation requires owned POSIX process groups'));
  const input = yield* Effect.try({ try: () => JSON.stringify(job), catch: failure });
  if (Buffer.byteLength(input) > P.editorLimits.input) return yield* Effect.fail(new ConcordError('EditorBudgetExceeded', 'Job input limit'));
  let attempted = false;
  const work = Effect.gen(function*() {
    const owner = yield* OwnedProcess;
    attempted = true;
    const result = yield* owner.run([process.execPath, '--max-old-space-size=256', fileURLToPath(new URL('./editor-worker.js', import.meta.url))], {
      cwd: job.root, stdin: input, timeoutMs: P.editorLimits.timeout, outputLimitBytes: P.editorLimits.output,
    }).pipe(Effect.mapError(error => new ConcordError('EditorTaskFailed', error.detail)));
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
