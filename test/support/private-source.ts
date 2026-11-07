import { cpSync, mkdirSync, symlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { nativeArtifactRoot, nativeSourceFiles } from '../../src/base/installation/index.ts';
import { sourceRoot } from './source-consumer.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);

/** Source mutation and artifact-damage fixtures own both their source tree and native cache. */
export function privateSourceInstallation(target: string): string {
  mkdirSync(target, { recursive: true });
  const checkout = sourceRoot;
  for (const path of ['src', 'web', 'scripts', 'templates', 'skills', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'vite.config.ts', 'vite.source.config.ts', 'vite.preview.config.ts']) {
    cpSync(join(checkout, path), join(target, path), { recursive: true });
  }
  for (const path of nativeSourceFiles) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    cpSync(join(checkout, path), join(target, path));
  }
  cpSync(nativeArtifactRoot(runtime), join(target, '.test-cache/concord/native', basename(nativeArtifactRoot(runtime))), { recursive: true });
  symlinkSync(join(checkout, 'node_modules'), join(target, 'node_modules'), 'junction');
  return join(target, 'src/entry/cli/entry.ts');
}
