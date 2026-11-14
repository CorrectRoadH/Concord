import { execFileSync } from 'node:child_process';
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
  for (const path of ['src', 'web', 'scripts', 'docs', 'templates', 'skills', 'patches', '.bun-version', 'tsconfig.json', 'package.json', 'bun.lock', 'vite.config.ts', 'vite.source.config.ts', 'vite.preview.config.ts']) {
    cpSync(join(checkout, path), join(target, path), { recursive: true });
  }
  for (const path of nativeSourceFiles) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    cpSync(join(checkout, path), join(target, path));
  }
  cpSync(nativeArtifactRoot(runtime), join(target, '.test-cache/concord/native', basename(nativeArtifactRoot(runtime))), { recursive: true });
  symlinkSync(join(checkout, 'node_modules'), join(target, 'node_modules'), 'junction');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  execFileSync('git', ['init', '-q', target], { env });
  execFileSync('git', ['-C', target, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Source installation fixture'], { env });
  return join(target, 'src/entry/cli/entry.ts');
}
