// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#安装与卸载
import { Effect } from 'effect';
import { Installation } from '../base/installation/index.js';

export const manageHerdrMod = Effect.fn('manageHerdrMod')(function*(operation: 'install' | 'uninstall', dryRun = false) {
  return yield* (yield* Installation).herdrMod(operation, dryRun);
});
