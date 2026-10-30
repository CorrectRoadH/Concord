import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Effect, Schema } from 'effect';

class PackageLocationInvalid extends Schema.TaggedError<PackageLocationInvalid>()('PackageLocationInvalid', { message: Schema.String }) {}
const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) }));
/** Packaging and acceptance resolve the bin from the artifact's own manifest. */
export function packageBin(root: string): string {
  return Effect.runSync(Effect.try({ try: () => {
    const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(root, 'package.json'), 'utf8'));
    const file = resolve(root, manifest.bin.concord);
    if (!file.startsWith(resolve(root) + sep)) throw new Error('Package bin escapes its installation');
    return file;
  }, catch: cause => new PackageLocationInvalid({ message: String(cause) }) }));
}
