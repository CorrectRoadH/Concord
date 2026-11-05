import { join, resolve, sep } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';

export class PackageLocationInvalid extends Schema.TaggedError<PackageLocationInvalid>()('PackageLocationInvalid', { message: Schema.String }) {}
const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) }));
/** Packaging and acceptance resolve the bin from the artifact's own manifest. */
export const packageBin = Effect.fn('packageBin')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = join(root, 'src/entry/cli/entry.ts');
  if (yield* fs.exists(source)) return source;
  const manifest = yield* Schema.decodeUnknownEffect(Manifest, { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(root, 'package.json')));
  const file = resolve(root, manifest.bin.concord);
  if (!file.startsWith(resolve(root) + sep)) return yield* new PackageLocationInvalid({ message: 'Package bin escapes its installation' });
  return file;
}, Effect.mapError(cause => cause instanceof PackageLocationInvalid ? cause : new PackageLocationInvalid({ message: String(cause) })));
