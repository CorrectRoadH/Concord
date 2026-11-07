// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md
import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { recoverLocalState } from "../../app/index.ts";
import { ConcordError } from "../../model/index.ts";
import { root, emit, sync } from "./cli-base.ts";
import { setExitCode } from './invocation.ts';

const recover = Command.make('recover', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'recover does not accept --dry-run'));
  const receipt = yield* recoverLocalState(Option.getOrUndefined(settings.root));
  if (receipt.status === 'blocked') yield* setExitCode(1);
  yield* emit(receipt, settings.json);
})).pipe(Command.withDescription('Recover the current document or Trace publication; preserve conflicting external edits.'));

export { recover };
