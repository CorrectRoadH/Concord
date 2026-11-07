// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
import { Effect } from 'effect';
import { ConcordError, failure } from '../../model/index.ts';
import { CliInvocation, setExitCode, writeStderr } from './invocation.ts';
import { humanOutput } from './presentation.ts';

export const cliFailure = Effect.fn('cliFailure')(function*(cause: unknown) {
  const CliError = yield* Effect.tryPromise(() => import('effect/cli/CliError'));
  const error = CliError.isCliError(cause) && cause._tag === 'ShowHelp' && cause.errors.length > 0
    ? new ConcordError('InvalidInput', cause.errors.map(item => item.message).join('; '))
    : failure(cause);
  const result = { ok: false, error: error.code, message: error.message, ...(error.code === 'WritingBudgetExceeded' ? { complete: false } : {}), ...(error.details === undefined ? {} : { details: error.details }) };
  const invocation = yield* CliInvocation;
  yield* writeStderr(`${invocation.argv.includes('--json') || invocation.argv.includes('--skill') ? JSON.stringify(result) : humanOutput(result)}\n`);
  yield* setExitCode(1);
});

