import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { packageBin } from '../../scripts/package-location.js';

export const distributionRoot = fileURLToPath(new URL('../..', import.meta.url));
const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String, files: Schema.Array(Schema.String) }));
export interface BuiltConcord { readonly name: string; readonly version: string; readonly filename: string; readonly files: readonly { readonly path: string }[] }
let distribution: BuiltConcord | undefined;

/** Describe the current build. This never creates a tarball or installs a package. */
export function builtConcord(_destination?: string): BuiltConcord {
  return Effect.runSync(Effect.sync(() => {
    if (distribution !== undefined) return distribution;
    const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(distributionRoot, 'package.json'), 'utf8'));
    const visit = (path: string): { path: string }[] => {
      const entries = readdirSync(join(distributionRoot, path), { withFileTypes: true });
      return entries.flatMap(entry => entry.isDirectory() ? visit(join(path, entry.name)) : [{ path: join(path, entry.name) }]);
    };
    const files = manifest.files.flatMap(path => existsSync(join(distributionRoot, path))
      ? /\.[a-z]+$/u.test(path) ? [{ path }] : visit(path) : []);
    for (const name of readdirSync(distributionRoot)) if (/^README(?:\..+)?\.md$/u.test(name) && !files.some(file => file.path === name)) files.push({ path: name });
    for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) if (!files.some(file => file.path === path)) files.push({ path });
    return distribution = { name: manifest.name, version: manifest.version, filename: distributionRoot, files };
  }));
}

/** Consumers share source. Only damage fixtures copy the runtime files they modify. */
export function prepareBuiltConsumer(directory: string, artifact: BuiltConcord, dependencies: readonly string[] = [], options: { private?: boolean } = {}): void {
  Effect.runSync(Effect.sync(() => {
    const modules = join(directory, 'node_modules'); mkdirSync(modules, { recursive: true });
    const target = join(modules, artifact.name);
    if (options.private) {
      mkdirSync(target);
      for (const path of ['src', 'web', 'native', 'scripts', 'vite.config.ts', 'vite.preview.config.ts', 'templates', 'skills', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        cpSync(join(distributionRoot, path), join(target, path), { recursive: true });
      }
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

// Existing callers (including files owned by other workers) keep their helper
// imports while consuming the build directly. These aliases do no packaging.
export { builtConcord as packConcord, prepareBuiltConsumer as installConcord };
