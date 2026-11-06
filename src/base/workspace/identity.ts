import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, digest, failure } from '../../model/index.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { discoverRoot } from './bootstrap.ts';
import { assertLeasePath, genericPrivateDirectorySync } from '../publication/index.ts';

/** Service startup locates the worktree before inspecting its potentially broken configuration. */
export const locateWorkspace = Effect.fn('Workspace.locate')((input: string | undefined, allowUninitialized = false, runtime?: RuntimeEnvironmentSnapshot) => Effect.try({
  try: () => { const root = discoverRoot(input, allowUninitialized, runtime); return { root, privateDir: genericPrivateDirectorySync(root, runtime?.env) }; }, catch: failure,
}));

/** Identity reads do not require a valid configuration, so a broken file can be diagnosed. */
export const identifyWorkspace = Effect.fn('Workspace.identify')((input: string | undefined, allowUninitialized = false, strictFile = false, runtime?: RuntimeEnvironmentSnapshot) => Effect.try({
  try: () => {
    const root = discoverRoot(input, allowUninitialized, runtime), privateDir = genericPrivateDirectorySync(root, runtime?.env);
    const path = join(root, 'concord.config.ts');
    assertLeasePath(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (strictFile && stat && (!stat.isFile() || stat.size > 4 * 1024 * 1024)) throw new ConcordError('InvalidConfig', 'Configuration must be a regular file within 4 MiB');
    if (stat !== undefined && stat.size > 4 * 1024 * 1024) throw new ConcordError('InvalidConfig', 'Configuration exceeds 4 MiB');
    return { root, privateDir, config: stat === undefined ? null : digest(readFileSync(path)) };
  }, catch: failure,
}));
