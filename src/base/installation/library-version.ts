// @concord-file
// @concord-implements docs/feature/local-sdlc/library.md#版本
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { ConcordError } from '../../model/index.ts';
import { packageRoot } from './location.ts';

const Version = Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString }));
function version(path: string): string {
  return Schema.decodeUnknownSync(Version, { onExcessProperty: 'ignore' })(readFileSync(path, 'utf8')).version;
}

/** The optional project library is metadata, never an executable module. */
export function projectLibraryVersions(root: string): { cli: string; library?: string } {
  const cli = version(join(packageRoot, 'package.json'));
  try { return { cli, library: version(join(root, 'node_modules/concord-sdlc/package.json')) }; }
  catch (cause) {
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT') return { cli };
    throw new ConcordError('InvalidData', 'Cannot read the installed concord-sdlc version', cause);
  }
}
