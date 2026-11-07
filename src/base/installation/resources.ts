import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Schema } from 'effect';
import { applicationRoot, packagedRuntimeForApplication } from './archive-location.ts';
import { packageRoot } from './location.ts';

export const resourcePath = (path: string): string => join(packageRoot, path);

const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.Literal('concord-sdlc') }));
/** Source and compiled CLI resources have one layout owner. */
export function installationResources(root: string) {
  root = applicationRoot(root);
  const distribution = join(root, 'dist');
  const source = existsSync(join(root, 'src/entry/cli/entry.ts'));
  const runtime = join(root, 'src');
  const packagedRuntime = packagedRuntimeForApplication(root);
  return {
    packagedRuntime,
    bin: source ? join(runtime, 'entry/cli/entry.ts') : packagedRuntime?.concord ?? join(root, '../bin/concord'),
    native: join(distribution, 'native'),
    web: join(distribution, 'web'),
    herdrMod: join(distribution, 'herdr-mod'),
    worker: (name: string) => join(runtime, 'entry/server', `${name}.ts`),
  };
}

/** Resolve the archive application or source checkout owning the executable. */
export function installationRootForBin(bin: string): string {
  const launcherRoot = resolve(dirname(bin), '..');
  if (resolve(launcherRoot, 'bin/concord') === resolve(bin) && existsSync(join(launcherRoot, 'app/package.json'))) return join(launcherRoot, 'app');
  let directory = dirname(resolve(bin));
  for (;;) {
    try {
      Schema.decodeUnknownSync(Manifest, { onExcessProperty: 'ignore' })(readFileSync(join(directory, 'package.json'), 'utf8'));
      if (resolve(directory, 'src/entry/cli/entry.ts') === resolve(bin)) return directory;
    } catch { /* A containing directory may belong to a dependency workspace. */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('InstallationUnavailable: executable has no matching package manifest');
    directory = parent;
  }
}
