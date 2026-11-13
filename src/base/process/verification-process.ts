// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
import { Cause, Context, Effect } from 'effect';
import { failure } from '../../model/index.ts';
import { runOwnedProcess, type OwnedProcessOptions } from './owned-process.ts';
import { processDiagnostic, type ProcessDiagnostic } from './process-diagnostic.ts';

export const VerificationProcessGuard = Context.Reference<{ readonly capture: () => (process: ProcessDiagnostic) => void } | undefined>('concord/VerificationProcessGuard', { defaultValue: () => undefined });

/** Only the verification scope supplies this guard; ordinary test runs keep their environment. */
export const runTestProcess = Effect.fn('runTestProcess')(function*(argv: readonly string[], options: OwnedProcessOptions, root: string, step: string, op?: string) {
  const guard = yield* VerificationProcessGuard;
  if (guard === undefined) return yield* runOwnedProcess(argv, options).pipe(Effect.mapError(failure));
  return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    const check = yield* Effect.try({ try: guard.capture, catch: failure });
    const result = yield* Effect.exit(restore(runOwnedProcess(argv, { ...options, env: { ...options.env, CONCORD_VERIFICATION: '1', pnpm_config_verify_deps_before_run: 'false', npm_config_verify_deps_before_run: 'false' } }).pipe(Effect.mapError(failure))));
    const diagnostic: ProcessDiagnostic = result._tag === 'Success' ? processDiagnostic(result.value, root, options.cwd, step, op) : {
      step, ...(op === undefined ? {} : { op }), argv, cwd: options.cwd === root ? '.' : options.cwd, exitCode: null, signal: null, timedOut: false,
      cancelled: Cause.hasInterruptsOnly(result.cause), stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false,
    };
    yield* Effect.try({ try: () => check(diagnostic), catch: failure });
    if (result._tag === 'Failure') return yield* Effect.failCause(result.cause);
    return result.value;
  }));
});
