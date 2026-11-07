// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
// @concord-implements docs/feature/web-workbench/cli.md
import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { ConcordError } from "../../model/index.ts";
import { applyViewDryRun, executeViewAction } from "../../app/index.ts";
import { root, optional, many, body, emit, sync, viewRoot } from "./cli-base.ts";
import { setExitCode } from './invocation.ts';

const action = Command.make('action', { input: optional('input'), inputText: many('input-text') }, args => Effect.gen(function*() {
  const settings = yield* root;
  if (Option.isSome(args.input) === (args.inputText.length > 0)) return yield* Effect.fail(new ConcordError('InvalidInput', 'Provide either --input <file|-> or --input-text <JSON>'));
  const source = Option.isSome(args.input) ? yield* body(args.input.value) : args.inputText.join('');
  if (Buffer.byteLength(source) > 4 * 1024 * 1024) return yield* Effect.fail(new ConcordError('InvalidBody', 'Author content exceeds 4 MiB'));
  const input = yield* sync(() => { try { return applyViewDryRun(JSON.parse(source) as unknown, settings.dryRun); } catch (cause) { throw cause instanceof ConcordError ? cause : new ConcordError('InvalidJson', `Action input is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`); } });
  const result = yield* executeViewAction((yield* viewRoot(settings)), input);
  if (input.action === 'recover' && typeof result === 'object' && result !== null && 'status' in result && result.status === 'blocked') yield* setExitCode(1);
  yield* emit(result, settings.json);
})).pipe(Command.withDescription('Execute one strict shared ViewAction from --input <file|-> or repeatable --input-text <JSON>.'));

export { action };
