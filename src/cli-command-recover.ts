// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { recoverLocalState } from './recovery.js';
import { ConcordError } from './shared.js';
import { root, emit, sync } from './cli-base.js';

const recover = Command.make('recover', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'recover does not accept --dry-run'));
  const receipt = yield* recoverLocalState(Option.getOrUndefined(settings.root));
  if (receipt.status === 'blocked') process.exitCode = 1;
  yield* Effect.sync(() => emit(receipt, settings.json));
})).pipe(Command.withDescription('Recover the current document or Trace publication; preserve conflicting external edits.'));

export { recover };
