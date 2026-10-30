import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Schema } from 'effect';

const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) }));
/** Installed resource layout has one owner; consumers resolve the bin from its manifest. */
export function installationResources(root: string) {
  const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(root, 'package.json'), 'utf8'));
  const distribution = join(root, 'dist');
  return {
    bin: join(root, manifest.bin.concord),
    help: join(distribution, 'startup-data.js'),
    native: join(distribution, 'native'),
    web: join(distribution, 'web'),
    command: (group: string) => join(distribution, 'entry/cli', `cli-command-${group}.js`),
    fallback: join(distribution, 'entry/cli/cli-fallback-bundle.js'),
    skill: join(distribution, 'entry/cli/skill.js'),
    worker: (name: string) => join(distribution, 'entry/server', `${name}.js`),
  };
}

/** Resolve an installed resource owner from the manifest-declared executable. */
export function installationRootForBin(bin: string): string {
  let directory = dirname(resolve(bin));
  for (;;) {
    try {
      const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (resolve(directory, manifest.bin.concord) === resolve(bin)) return directory;
    } catch { /* A containing directory may belong to a dependency workspace. */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('InstallationUnavailable: executable has no matching package manifest');
    directory = parent;
  }
}
