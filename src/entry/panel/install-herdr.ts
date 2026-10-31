import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { resolve, join } from 'node:path';
import { bindHerdrManifest } from './herdr.js';

/** npm installs this package before Herdr links its manifest directory. */
const install = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const root = resolve(import.meta.dirname, '../../..');
  // Source bootstraps may run before dist exists; only bind installed packages.
  if (yield* fs.exists(join(root, 'src/entry/cli/entry.ts'))) return;
  const manifest = join(root, 'herdr/herdr-plugin.toml');
  const source = yield* fs.readFileString(manifest);
  const bound = bindHerdrManifest(source, join(root, 'dist/entry/cli/entry.js'), process.execPath, join(root, 'dist/entry/panel/herdr-action.js'));
  const temporary = `${manifest}.${process.pid}.tmp`;
  yield* fs.writeFileString(temporary, bound).pipe(
    Effect.andThen(fs.rename(temporary, manifest)),
    Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.orDie)),
  );
});
NodeRuntime.runMain(install.pipe(Effect.provide(NodeServices.layer)));
