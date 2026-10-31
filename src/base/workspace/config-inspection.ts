import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, digest, failure, type ConfigSnapshot } from '../../model/index.js';
import { assertCurrentRuntimeFormat } from './storage.js';
import { snapshot } from './config.js';
import { discoverRoot } from './storage.js';
import { assertLeasePath, genericPrivateDirectorySync } from '../publication/index.js';

export interface ConfigurationInspection {
  readonly path: 'concord.config.ts';
  readonly source: string | undefined;
  readonly digest: string | null;
  readonly snapshot?: ConfigSnapshot;
  readonly diagnostic?: ConcordError;
}

function inspectNow(root: string): ConfigurationInspection {
  const path = 'concord.config.ts';
  const absolute = join(root, path);
  const unavailable = (cause: unknown, source?: string): ConfigurationInspection => ({ path, source, digest: source === undefined ? null : digest(source), diagnostic: failure(cause) });
  try { assertCurrentRuntimeFormat(root); } catch (cause) { return unavailable(cause); }
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
    const parsed = snapshot(path, source);
    return { path, source, digest: parsed.digest, snapshot: parsed };
  } catch (cause) { return unavailable(cause, source); }
}

/** Reread the current bytes, including malformed configurations for inspection. */
export const inspectConfiguration = Effect.fn('Workspace.inspectConfiguration')((root: string) => Effect.try({ try: () => inspectNow(root), catch: failure }));

export { identifyWorkspace, locateWorkspace } from './identity.js';
