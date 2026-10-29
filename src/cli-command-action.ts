// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ConcordError } from './shared.js';
import { applyViewDryRun, executeViewAction } from './application.js';
import { root, text, body, emit, sync, viewRoot } from './cli-base.js';

const action = Command.make('action', { input: text('input') }, args => Effect.gen(function*() {
  const settings = yield* root;
  const input = yield* sync(() => { try { return applyViewDryRun(JSON.parse(body(args.input)) as unknown, settings.dryRun); } catch (cause) { throw cause instanceof ConcordError ? cause : new ConcordError('InvalidJson', `Action input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); } });
  const result = yield* executeViewAction(viewRoot(settings), input);
  if (input.action === 'recover' && typeof result === 'object' && result !== null && 'status' in result && result.status === 'blocked') process.exitCode = 1;
  yield* Effect.sync(() => emit(result, settings.json));
})).pipe(Command.withDescription('Execute one strict shared ViewAction from --input <file|->.'));

export { action };
