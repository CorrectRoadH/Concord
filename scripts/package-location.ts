import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';

export class PackageLocationInvalid extends Schema.TaggedError<PackageLocationInvalid>()('PackageLocationInvalid', { message: Schema.String }) {}
/** Tooling accepts the compiled CLI archive or the source checkout. */
export const packageBin = Effect.fn('packageBin')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const launcher = join(root, 'bin/concord');
  if ((yield* fs.exists(launcher)) && (yield* fs.exists(join(root, 'app/package.json')))) return launcher;
  const source = join(root, 'src/entry/cli/entry.ts');
  if (yield* fs.exists(source)) return source;
  return yield* new PackageLocationInvalid({ message: `No Concord CLI archive or source checkout: ${root}` });
}, Effect.mapError(cause => cause instanceof PackageLocationInvalid ? cause : new PackageLocationInvalid({ message: String(cause) })));
