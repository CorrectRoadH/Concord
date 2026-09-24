import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';

const Manifest = Schema.Struct({ version: Schema.String });
const Shrinkwrap = Schema.Struct({
  version: Schema.String,
  packages: Schema.Struct({ '': Schema.Struct({ version: Schema.String }) }),
});
class ReleasePreparationError extends Schema.TaggedError<ReleasePreparationError>()('ReleasePreparationError', {
  message: Schema.String,
}) {}

const prepare = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const tag = process.env.RELEASE_TAG ?? '';
  const manifestText = yield* fs.readFileString('package.json');
  const shrinkwrapText = yield* fs.readFileString('npm-shrinkwrap.json');
  const manifest = JSON.parse(manifestText) as unknown;
  const shrinkwrap = JSON.parse(shrinkwrapText) as unknown;
  const current = Schema.decodeUnknownSync(Manifest)(manifest).version;
  const locked = Schema.decodeUnknownSync(Shrinkwrap)(shrinkwrap);
  if (locked.version !== current || locked.packages[''].version !== current) {
    return yield* new ReleasePreparationError({ message: 'Package and npm-shrinkwrap.json root versions disagree' });
  }
  if (tag === '') return;
  const match = /^(?:concord-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (match === null) return yield* new ReleasePreparationError({ message: `Invalid release tag: ${tag}` });
  const version = match[0].replace(/^(?:concord-)?v/, '');
  const nextManifest = { ...(manifest as Record<string, unknown>), version };
  const nextShrinkwrap = {
    ...(shrinkwrap as Record<string, unknown>),
    version,
    packages: {
      ...(shrinkwrap as { packages: Record<string, unknown> }).packages,
      '': { ...(shrinkwrap as { packages: { '': Record<string, unknown> } }).packages[''], version },
    },
  };
  yield* fs.writeFileString('package.json', `${JSON.stringify(nextManifest, null, 2)}\n`);
  yield* fs.writeFileString('npm-shrinkwrap.json', `${JSON.stringify(nextShrinkwrap, null, 2)}\n`);
  yield* Effect.sync(() => process.stdout.write(`Prepared Concord ${version} from ${tag}\n`));
});

prepare.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
