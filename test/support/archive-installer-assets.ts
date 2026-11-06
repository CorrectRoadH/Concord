import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { withInstaller } from './install-script-fixture.ts';

type Installer = Parameters<Parameters<typeof withInstaller>[0]>[0];

/** Serve the exact built asset instead of recompressing an unchanged installation. */
export function publishArchiveCandidate(fixture: Installer, version: string, root: string, archive?: string): void {
  if (!archive) return fixture.publishArchive(version, root);
  const target = join(fixture.release, 'download', `v${version}`);
  mkdirSync(target, { recursive: true });
  const filename = `concord-${version}-${process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64'}.tar.gz`;
  copyFileSync(archive, join(target, filename));
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(target, 'SHA256SUMS'), `${digest}  ${filename}\n`);
}
