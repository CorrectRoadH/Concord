// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
import { Effect } from "effect";
import { Command } from "effect/cli";
import { ConcordError } from "../../model/index.ts";
import { applyViewDryRun, executeViewAction } from "../../app/index.ts";
import { root, text, body, emit, sync, viewRoot } from "./cli-base.ts";
import { setExitCode } from './invocation.ts';

const action = Command.make('action', { input: text('input') }, args => Effect.gen(function*() {
  const settings = yield* root;
  const source = yield* body(args.input);
  const input = yield* sync(() => { try { return applyViewDryRun(JSON.parse(source) as unknown, settings.dryRun); } catch (cause) { throw cause instanceof ConcordError ? cause : new ConcordError('InvalidJson', `Action input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); } });
  const result = yield* executeViewAction((yield* viewRoot(settings)), input);
  if (input.action === 'recover' && typeof result === 'object' && result !== null && 'status' in result && result.status === 'blocked') yield* setExitCode(1);
  yield* emit(result, settings.json);
})).pipe(Command.withDescription('Execute one strict shared ViewAction from --input <file|->.'));

export { action };
