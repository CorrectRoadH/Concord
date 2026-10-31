// @concord-file
// @concord-implements docs/feature/herdr-panel/use-case/open-side-panel.md
import { Effect, Option } from 'effect';
import { Command } from 'effect/unstable/cli';
import { ConcordError } from '../../model/index.js';
import { PanelLauncher } from './launchers.js';
import { root } from './cli-base.js';
export const panel = Command.make('panel', {}, () => Effect.gen(function*() {
  const settings = yield* root;
  if (settings.dryRun) return yield* Effect.fail(new ConcordError('InvalidOption', 'panel does not accept --dry-run'));
  return yield* (yield* PanelLauncher).serve(Option.getOrUndefined(settings.root));
})).pipe(Command.withDescription('Open a readonly terminal panel connected to the worktree service.'));
