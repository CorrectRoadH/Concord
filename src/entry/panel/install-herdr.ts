// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#herdr-插件
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { resolve, join } from 'node:path';
import { bindHerdrManifest, pluginDestinationAllowed } from './herdr.js';

class PanelPluginDestinationInvalid extends Schema.TaggedError<PanelPluginDestinationInvalid>()('PanelPluginDestinationInvalid', { message: Schema.String }) {}
/** Invoked by Herdr's build step, never by an npm lifecycle. */
const install = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const args = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.Literal('--plugin-dir'), Schema.String]))(process.argv.slice(2));
  const root = yield* fs.realPath(resolve(import.meta.dirname, '../../..'));
  const destination = yield* fs.realPath(resolve(args[1]));
  // Refuse the package (including source checkouts) even when reached by symlink.
  if (!pluginDestinationAllowed(root, destination)) {
    return yield* new PanelPluginDestinationInvalid({ message: 'Bind into Herdr’s private plugin directory, outside the Concord installation.' });
  }
  const manifest = join(destination, 'herdr-plugin.toml');
  const source = yield* fs.readFileString(manifest);
  const bound = bindHerdrManifest(source, join(root, 'dist/entry/cli/entry.js'), process.execPath, join(root, 'dist/entry/panel/herdr-action.js'));
  const temporary = `${manifest}.${process.pid}.tmp`;
  yield* fs.writeFileString(temporary, bound).pipe(
    Effect.andThen(fs.rename(temporary, manifest)),
    Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.orDie)),
  );
});
NodeRuntime.runMain(install.pipe(Effect.provide(NodeServices.layer)));
