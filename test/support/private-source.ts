import { cpSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { nativeArtifactRoot, nativeSourceFiles } from '../../src/base/installation/index.ts';

/** Only tests of source-mode behavior own a copied source installation. */
export function privateSourceInstallation(target: string): string {
  mkdirSync(target, { recursive: true });
  const checkout = resolve('.');
  for (const path of ['src', 'web', 'scripts', 'templates', 'skills', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'vite.source.config.ts', 'vite.preview.config.ts']) {
    cpSync(join(checkout, path), join(target, path), { recursive: true });
  }
  for (const path of [...nativeSourceFiles.filter(path => path.startsWith('native/')), 'native/hawdb/Cargo.lock']) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    cpSync(join(checkout, path), join(target, path));
  }
  cpSync(nativeArtifactRoot, join(target, '.test-cache/concord/native', basename(nativeArtifactRoot)), { recursive: true });
  symlinkSync(join(checkout, 'node_modules'), join(target, 'node_modules'), 'junction');
  return join(target, 'src/entry/cli/entry.ts');
}
