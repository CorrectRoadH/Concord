import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The application keeps its concord-sdlc package identity inside archive/app. */
export const applicationRoot = (root: string): string => existsSync(join(root, 'app/package.json')) ? join(root, 'app') : root;
export const archiveRootForApplication = (root: string): string | undefined => {
  const parent = dirname(root);
  return existsSync(join(parent, 'runtime/rg')) && existsSync(join(parent, 'bin/concord')) ? parent : undefined;
};
export const packagedRuntimeForApplication = (root: string): { concord: string; rg: string } | undefined => {
  const archive = archiveRootForApplication(applicationRoot(root));
  return archive === undefined ? undefined : { concord: join(archive, 'bin/concord'), rg: join(archive, 'runtime/rg') };
};
