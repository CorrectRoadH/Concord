import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { packageBin } from '../../scripts/package-location.js';
import { nativeArtifactRoot, nativeSourceFiles } from '../../src/base/installation/index.js';

export const distributionRoot = fileURLToPath(new URL('../..', import.meta.url));
const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String, files: Schema.Array(Schema.String) }));
export interface BuiltConcord { readonly name: string; readonly version: string; readonly filename: string; readonly files: readonly { readonly path: string }[] }

/** Describe the current build. This never creates a tarball or installs a package. */
export function builtConcord(destination: string): BuiltConcord {
  return Effect.runSync(Effect.sync(() => {
    const root = destination;
    const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(root, 'package.json'), 'utf8'));
    const visit = (path: string): { path: string }[] => {
      const entries = readdirSync(join(root, path), { withFileTypes: true });
      return entries.flatMap(entry => entry.isDirectory() ? visit(join(path, entry.name)) : [{ path: join(path, entry.name) }]);
    };
    const files = manifest.files.flatMap(path => existsSync(join(root, path))
      ? /\.[a-z]+$/u.test(path) ? [{ path }] : visit(path) : []);
    for (const name of readdirSync(root)) if (/^README(?:\..+)?\.md$/u.test(name) && !files.some(file => file.path === name)) files.push({ path: name });
    for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) if (!files.some(file => file.path === path)) files.push({ path });
    const result = { name: manifest.name, version: manifest.version, filename: root, files };
    return result;
  }));
}

/** Consumers share source. Only damage fixtures copy the runtime files they modify. */
export function prepareSourceConsumer(directory: string, artifact: BuiltConcord, dependencies: readonly string[] = [], options: { private?: boolean } = {}): void {
  Effect.runSync(Effect.sync(() => {
    const modules = join(directory, 'node_modules'); mkdirSync(modules, { recursive: true });
    const target = join(modules, artifact.name);
    if (options.private) {
      mkdirSync(target);
      for (const path of ['src', 'web', 'scripts', 'vite.config.ts', 'vite.source.config.ts', 'vite.preview.config.ts', 'templates', 'skills', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        cpSync(join(distributionRoot, path), join(target, path), { recursive: true });
      }
      for (const path of [...nativeSourceFiles.filter(path => path.startsWith('native/')), 'native/hawdb/Cargo.lock']) {
        mkdirSync(dirname(join(target, path)), { recursive: true }); cpSync(join(distributionRoot, path), join(target, path));
      }
      cpSync(nativeArtifactRoot, join(target, '.test-cache/concord/native', nativeArtifactRoot.split('/').at(-1)!), { recursive: true });
      symlinkSync(join(distributionRoot, 'node_modules'), join(target, 'node_modules'), 'junction');
    } else symlinkSync(distributionRoot, target, 'junction');
    for (const dependency of dependencies) {
      const name = dependency.slice(0, dependency.lastIndexOf('@'));
      const path = join(modules, name); mkdirSync(dirname(path), { recursive: true });
      symlinkSync(join(distributionRoot, 'node_modules', name), path, 'junction');
    }
    if (dependencies.length) cpSync(join(distributionRoot, 'node_modules/.bin'), join(modules, '.bin'), { recursive: true });
    mkdirSync(join(modules, '.bin'), { recursive: true });
    const cli = packageBin(target);
    if (process.platform === 'win32') writeFileSync(join(modules, '.bin/concord.cmd'), `@"${process.execPath}" "${cli}" %*\r\n`);
    else {
      writeFileSync(join(modules, '.bin/concord'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} --conditions=concord-source --import ${JSON.stringify(import.meta.resolve('tsx'))} ${JSON.stringify(cli)} "$@"\n`);
      chmodSync(join(modules, '.bin/concord'), 0o755);
    }
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(join(directory, 'package.json'), 'utf8'));
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ ...manifest, dependencies: { [artifact.name]: `file:${distributionRoot}`, ...Object.fromEntries(dependencies.map(dependency => [dependency.slice(0, dependency.lastIndexOf('@')), dependency.slice(dependency.lastIndexOf('@') + 1)])) } }, null, 2)}\n`);
  }));
}

/** Source consumers describe the checkout; this does not build or package it. */
export function sourceConcord(): BuiltConcord {
  const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(distributionRoot, 'package.json'), 'utf8'));
  const visit = (directory: string, prefix: string): { path: string }[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? visit(join(directory, entry.name), join(prefix, entry.name)) : [{ path: join(prefix, entry.name) }]);
  const files = ['src', 'web', 'templates', 'skills'].flatMap(path => visit(join(distributionRoot, path), path));
  files.push(...['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map(path => ({ path })));
  return { name: manifest.name, version: manifest.version, filename: distributionRoot, files };
}
