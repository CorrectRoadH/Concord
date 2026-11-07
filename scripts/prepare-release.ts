// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { isDeepStrictEqual } from 'node:util';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';

const Dependencies = Schema.Record(Schema.String, Schema.String);
const InstallPolicy = { overrides: Dependencies, patchedDependencies: Dependencies, trustedDependencies: Schema.Array(Schema.String) };
const Manifest = Schema.Struct({ version: Schema.String, packageManager: Schema.String, dependencies: Dependencies, devDependencies: Dependencies, ...InstallPolicy });
const Lock = Schema.Struct({
  lockfileVersion: Schema.Literal(2), configVersion: Schema.Literal(1), ...InstallPolicy,
  workspaces: Schema.Struct({ '': Schema.Struct({ name: Schema.Literal('concord-sdlc'), dependencies: Dependencies, devDependencies: Dependencies }) }),
  packages: Schema.Record(Schema.String, Schema.Unknown),
});
class ReleasePreparationError extends Schema.TaggedError<ReleasePreparationError>()('ReleasePreparationError', { message: Schema.String }) {}

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
const prepare = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const tag = process.env.RELEASE_TAG ?? '';
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(yield* fs.readFileString('package.json'));
  const current = yield* Schema.decodeUnknownEffect(Manifest)(manifest);
  const text = yield* fs.readFileString('bun.lock');
  const parsed: unknown = yield* Effect.try({ try: () => Bun.JSON5.parse(text), catch: cause => new ReleasePreparationError({ message: `Invalid bun.lock: ${String(cause)}` }) });
  const locked = yield* Schema.decodeUnknownEffect(Lock, { onExcessProperty: 'error' })(parsed).pipe(
    Effect.mapError(cause => new ReleasePreparationError({ message: `Invalid bun.lock: ${String(cause)}` })),
  );
  const versionPin = (yield* fs.readFileString('.bun-version')).trim();
  if (current.packageManager !== `bun@${versionPin}` || process.versions.bun !== versionPin) {
    return yield* new ReleasePreparationError({ message: 'Package manager and running Bun must match .bun-version' });
  }
  for (const kind of ['dependencies', 'devDependencies'] as const) {
    if (!isDeepStrictEqual(current[kind], locked.workspaces[''][kind])) return yield* new ReleasePreparationError({ message: `Package and bun.lock ${kind} disagree` });
  }
  for (const kind of ['overrides', 'patchedDependencies', 'trustedDependencies'] as const) {
    const expected = kind === 'trustedDependencies' ? [...current[kind]].sort() : current[kind];
    const actual = kind === 'trustedDependencies' ? [...locked[kind]].sort() : locked[kind];
    if (!isDeepStrictEqual(expected, actual)) return yield* new ReleasePreparationError({ message: `Package and bun.lock ${kind} disagree` });
  }
  if (tag === '') return;
  const match = /^(?:concord-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (match === null) return yield* new ReleasePreparationError({ message: `Invalid release tag: ${tag}` });
  const version = match[0].replace(/^(?:concord-)?v/, '');
  yield* fs.writeFileString('package.json', `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  yield* Effect.sync(() => process.stdout.write(`Prepared Concord ${version} from ${tag}\n`));
});
prepare.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
