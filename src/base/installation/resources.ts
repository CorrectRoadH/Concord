import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Schema } from 'effect';
import { applicationRoot, packagedRuntimeForApplication } from './archive-location.ts';

const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) }));
/** Installed resource layout has one owner; consumers resolve the bin from its manifest. */
export function installationResources(root: string) {
  root = applicationRoot(root);
  const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(root, 'package.json'), 'utf8'));
  const distribution = join(root, 'dist');
  const source = existsSync(join(root, 'src/entry/cli/entry.ts'));
  const runtime = source ? join(root, 'src') : distribution;
  return {
    packagedRuntime: packagedRuntimeForApplication(root),
    bin: source ? join(runtime, 'entry/cli/entry.ts') : join(root, manifest.bin.concord),
    help: join(distribution, 'startup-data.js'),
    native: join(distribution, 'native'),
    web: join(distribution, 'web'),
    herdrMod: join(distribution, 'herdr-mod'),
    command: (group: string) => join(distribution, 'entry/cli', `cli-command-${group}.js`),
    fallback: join(distribution, 'entry/cli/cli-fallback-bundle.js'),
    skill: join(distribution, 'entry/cli/skill.js'),
    worker: (name: string) => join(runtime, 'entry/server', `${name}.${source ? 'ts' : 'js'}`),
  };
}

/** Resolve an installed resource owner from the manifest-declared executable. */
export function installationRootForBin(bin: string): string {
  const launcherRoot = resolve(dirname(bin), '..');
  if (resolve(launcherRoot, 'bin/concord') === resolve(bin) && existsSync(join(launcherRoot, 'app/package.json'))) return join(launcherRoot, 'app');
  let directory = dirname(resolve(bin));
  for (;;) {
    try {
      const manifest = Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (resolve(directory, manifest.bin.concord) === resolve(bin) || resolve(directory, 'src/entry/cli/entry.ts') === resolve(bin)) return directory;
    } catch { /* A containing directory may belong to a dependency workspace. */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('InstallationUnavailable: executable has no matching package manifest');
    directory = parent;
  }
}
