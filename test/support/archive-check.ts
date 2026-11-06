import { resolve } from 'node:path';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { verifyInstalledStartup } from './installed-startup.ts';
import { verifyInstalledHerdrMod } from './installed-herdr-mod.ts';
import { verifyArchiveConsumers } from './archive-consumers.ts';
import { verifyArchiveNative } from './archive-native.ts';
import { verifyArchiveInstaller } from './install-script-archive.ts';
import { verifyArchiveInstallerLifecycle } from './install-script-archive-lifecycle.ts';

// Each blocking external-boundary fixture has its own event loop. Its synchronous
// commands cannot delay another fixture's asynchronous HTTP/process cleanup.
Effect.gen(function*() {
  const [check, root, scratch, archive] = yield* Schema.decodeUnknownEffect(Schema.Tuple([
    Schema.Literals(['startup', 'herdr', 'consumers', 'native', 'installer', 'lifecycle']), Schema.String, Schema.String, Schema.String,
  ]))(process.argv.slice(2));
  const installed = resolve(root), directory = resolve(scratch);
  switch (check) {
    case 'startup': return yield* Effect.promise(() => verifyInstalledStartup(installed, directory));
    case 'herdr': return yield* Effect.sync(() => verifyInstalledHerdrMod(installed, directory));
    case 'consumers': return yield* Effect.promise(() => verifyArchiveConsumers(installed));
    case 'native': return yield* Effect.sync(() => verifyArchiveNative(installed));
    case 'installer': return yield* Effect.sync(() => verifyArchiveInstaller(installed, archive));
    case 'lifecycle': return yield* Effect.promise(() => verifyArchiveInstallerLifecycle(installed, archive));
  }
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
