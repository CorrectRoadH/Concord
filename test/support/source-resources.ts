import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { installationResources as resources, installationRootForBin, nativeArtifactRoot } from '../../src/base/installation/index.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
export { installationRootForBin };

export function installationResources(root: string) {
  const value = resources(root);
  return existsSync(join(root, 'src/entry/cli/entry.ts')) ? { ...value,
    native: existsSync(join(root, '.test-cache')) ? join(root, '.test-cache/concord/native', basename(nativeArtifactRoot(runtime))) : nativeArtifactRoot(runtime),
  } : value;
}
