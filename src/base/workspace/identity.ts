import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, digest, failure } from '../../model/index.js';
import { discoverRoot } from './bootstrap.js';
import { assertLeasePath, genericPrivateDirectorySync } from '../publication/index.js';

/** Service startup locates the worktree before inspecting its potentially broken configuration. */
export const locateWorkspace = Effect.fn('Workspace.locate')((input: string | undefined, allowUninitialized = false) => Effect.try({
  try: () => { const root = discoverRoot(input, allowUninitialized); return { root, privateDir: genericPrivateDirectorySync(root) }; }, catch: failure,
}));

/** Identity reads do not require a valid configuration, so a broken file can be diagnosed. */
export const identifyWorkspace = Effect.fn('Workspace.identify')((input: string | undefined, allowUninitialized = false, strictFile = false) => Effect.try({
  try: () => {
    const root = discoverRoot(input, allowUninitialized), privateDir = genericPrivateDirectorySync(root);
    const path = join(root, 'concord.config.ts');
    assertLeasePath(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (strictFile && stat && (!stat.isFile() || stat.size > 4 * 1024 * 1024)) throw new ConcordError('InvalidConfig', 'Configuration must be a regular file within 4 MiB');
    if (stat !== undefined && stat.size > 4 * 1024 * 1024) throw new ConcordError('InvalidConfig', 'Configuration exceeds 4 MiB');
    return { root, privateDir, config: stat === undefined ? null : digest(readFileSync(path)) };
  }, catch: failure,
}));
