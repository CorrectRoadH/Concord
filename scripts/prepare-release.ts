import { isDeepStrictEqual } from 'node:util';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { parse } from 'yaml';

const Dependencies = Schema.Record(Schema.String, Schema.String);
const Manifest = Schema.Struct({ version: Schema.String, dependencies: Dependencies, devDependencies: Dependencies });
const LockedDependencies = Schema.Record(Schema.String, Schema.Struct({ specifier: Schema.String }));
const Lock = Schema.Struct({
  lockfileVersion: Schema.Literal('9.0'), overrides: Dependencies,
  importers: Schema.Struct({ '.': Schema.Struct({ dependencies: LockedDependencies, devDependencies: LockedDependencies }) }),
});
class ReleasePreparationError extends Schema.TaggedError<ReleasePreparationError>()('ReleasePreparationError', { message: Schema.String }) {}

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
const prepare = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const tag = process.env.RELEASE_TAG ?? '';
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(yield* fs.readFileString('package.json'));
  const current = yield* Schema.decodeUnknownEffect(Manifest)(manifest);
  const locked = yield* Schema.decodeUnknownEffect(Lock)(parse(yield* fs.readFileString('pnpm-lock.yaml')));
  const workspace = yield* Schema.decodeUnknownEffect(Schema.Struct({ overrides: Dependencies }))(parse(yield* fs.readFileString('pnpm-workspace.yaml')));
  for (const kind of ['dependencies', 'devDependencies'] as const) {
    const specifiers = Object.fromEntries(Object.entries(locked.importers['.'][kind]).map(([name, value]) => [name, value.specifier]));
    if (!isDeepStrictEqual(current[kind], specifiers)) return yield* new ReleasePreparationError({ message: `Package and pnpm-lock.yaml ${kind} disagree` });
  }
  if (!isDeepStrictEqual(workspace.overrides, locked.overrides) || manifest.overrides !== undefined) {
    return yield* new ReleasePreparationError({ message: 'Overrides must be owned by pnpm-workspace.yaml and match pnpm-lock.yaml' });
  }
  if (tag === '') return;
  const match = /^(?:concord-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (match === null) return yield* new ReleasePreparationError({ message: `Invalid release tag: ${tag}` });
  const version = match[0].replace(/^(?:concord-)?v/, '');
  yield* fs.writeFileString('package.json', `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  yield* Effect.sync(() => process.stdout.write(`Prepared Concord ${version} from ${tag}\n`));
});
prepare.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
