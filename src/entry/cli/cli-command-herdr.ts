// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#安装与卸载
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { manageHerdrMod } from '../../app/index.js';
import { root, emit } from './cli-base.js';

export const herdr = Command.make('herdr').pipe(
  Command.withDescription('Install or remove Concord’s native Herdr mod.'),
  Command.withSubcommands((['install', 'uninstall'] as const).map(operation =>
    Command.make(operation, {}, () => Effect.gen(function*() {
      const settings = yield* root;
      const receipt = yield* manageHerdrMod(operation, settings.dryRun);
      yield* Effect.sync(() => emit(receipt, settings.json));
    })).pipe(Command.withDescription(operation === 'install' ? 'Copy the packaged mod into Herdr’s mods/concord directory.' : 'Remove only Herdr’s mods/concord directory.')),
  )),
);
