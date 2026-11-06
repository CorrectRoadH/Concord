import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { Effect } from 'effect';
import { ConcordError, digest, failure, type ConfigSnapshot } from '../../model/index.ts';
import { assertCurrentRuntimeFormat } from './storage.ts';
import { snapshot } from './config.ts';
import { discoverRoot } from './storage.ts';
import { assertLeasePath, genericPrivateDirectorySync } from '../publication/index.ts';
import { inheritContentCacheOwner } from '../cache/index.ts';

export interface ConfigurationInspection {
  readonly path: 'concord.config.ts';
  readonly source: string | undefined;
  readonly digest: string | null;
  readonly snapshot?: ConfigSnapshot;
  readonly diagnostic?: ConcordError;
}

function inspectNow(root: string, runtime?: RuntimeEnvironmentSnapshot): ConfigurationInspection {
  const path = 'concord.config.ts';
  const absolute = join(root, path);
  const unavailable = (cause: unknown, source?: string): ConfigurationInspection => ({ path, source, digest: source === undefined ? null : digest(source), diagnostic: failure(cause) });
  try { assertCurrentRuntimeFormat(root, genericPrivateDirectorySync(root, runtime?.env)); } catch (cause) { return unavailable(cause); }
  if (!existsSync(absolute)) {
    const config: ConfigSnapshot = { path, source: '', digest: digest(''), config: {} };
    return { path, source: '', digest: config.digest, snapshot: config };
  }
  let source: string;
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `${path} must not be a symbolic link`);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new ConcordError('InvalidFile', `${path} must be a small regular file`);
    source = readFileSync(absolute, 'utf8');
  } catch (cause) { return unavailable(cause); }
  try {
    const parsed = snapshot(path, source, undefined, false, runtime);
    return { path, source, digest: parsed.digest, snapshot: parsed };
  } catch (cause) { return unavailable(cause, source); }
}

/** Reread the current bytes, including malformed configurations for inspection. */
export const inspectConfiguration = Effect.fn('Workspace.inspectConfiguration')((input: string, runtime?: RuntimeEnvironmentSnapshot) => Effect.try({ try: () => {
  const root = discoverRoot(input, false, runtime);
  return inspectNow(root, runtime === undefined ? undefined : inheritContentCacheOwner(runtime, runtime, root));
}, catch: failure }));

export { identifyWorkspace, locateWorkspace } from './identity.ts';
