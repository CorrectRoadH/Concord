// @concord-file
// @concord-implements docs/feature/cross-platform-release/README.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { packageRoot } from './location.ts';

const Version = Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString }));
function version(path: string): string {
  return Schema.decodeUnknownSync(Version, { onExcessProperty: 'ignore' })(readFileSync(path, 'utf8')).version;
}

export function installedConcordVersion(): string {
  return version(join(packageRoot, 'package.json'));
}
