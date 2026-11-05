import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { installationResources as resources, installationRootForBin, nativeArtifactRoot } from '../../src/base/installation/index.js';
export { installationRootForBin };

export function installationResources(root: string) {
  const value = resources(root);
  return existsSync(join(root, 'src/entry/cli/entry.ts')) ? { ...value,
    native: existsSync(join(root, '.test-cache')) ? join(root, '.test-cache/concord/native', basename(nativeArtifactRoot)) : nativeArtifactRoot,
  } : value;
}
