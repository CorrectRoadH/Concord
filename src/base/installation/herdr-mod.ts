// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#安装与卸载
import { Effect, FileSystem } from 'effect';
import { join } from 'node:path';
import { ConcordError, failure } from '../../model/index.js';

/** Replace only this mod's packaged files, using rename for possibly mapped files. */
export const manageHerdrMod = Effect.fn('Installation.manageHerdrMod')(function*(
  operation: 'install' | 'uninstall', appHome: string, resources: string, dryRun = false,
) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(appHome)) || (yield* fs.stat(appHome)).type !== 'Directory') {
    return yield* Effect.fail(new ConcordError('HerdrNotFound', `Herdr configuration directory does not exist: ${appHome}`));
  }
  const path = join(appHome, 'mods', 'concord');
  const receipt = { operation: `herdr-${operation}` as const, path, ...(dryRun ? { dryRun: true } : {}) };
  if (dryRun) return receipt;
  // readLink does not follow the destination: never write through a different mod.
  const linked = yield* fs.readLink(path).pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)));
  if (linked) return yield* Effect.fail(new ConcordError('UnsafePath', 'Concord mod directory must not be a symbolic link'));
  if (operation === 'uninstall') {
    yield* fs.remove(path, { recursive: true, force: true });
    return receipt;
  }
  const assets = ['main.js', 'mod.json', 'NOTICE.txt'];
  for (const name of assets) {
    if (!(yield* fs.exists(join(resources, name)))) return yield* Effect.fail(new ConcordError('BuildRequired', 'Build Concord before installing the Herdr mod'));
  }
  yield* fs.makeDirectory(path, { recursive: true });
  for (const name of assets) {
    const temporary = join(path, `.${name}.${process.pid}.tmp`);
    yield* fs.copyFile(join(resources, name), temporary).pipe(
      Effect.andThen(fs.rename(temporary, join(path, name))),
      Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.orDie)),
    );
  }
  return receipt;
}, Effect.mapError(failure));
