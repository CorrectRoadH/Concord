import { readFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
import { installConcord } from '../support/installed-package.js';
import { PackageArtifact } from '../../scripts/release-package.js';

Effect.runSync(Effect.sync(() => {
  const [directory, manifest] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.String]))(process.argv.slice(2));
  const artifact = Schema.decodeUnknownSync(Schema.fromJsonString(PackageArtifact), { onExcessProperty: 'error' })(readFileSync(manifest, 'utf8'));
  installConcord(directory, artifact);
}));
