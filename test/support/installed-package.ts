import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { packageCommand } from '../../scripts/package-command.ts';
export const applicationRoot = (root: string): string => existsSync(join(root, 'app/package.json')) ? join(root, 'app') : root;
export const packageBin = (root: string): string => Effect.runSync(Effect.sync(() => {
  if (applicationRoot(root) !== root) return join(root, 'bin/concord');
  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) })))(readFileSync(join(root, 'package.json'), 'utf8'));
  return join(root, manifest.bin.concord);
}));

export const distributionRoot = fileURLToPath(new URL('../..', import.meta.url));
const Manifest = Schema.fromJsonString(Schema.Struct({ name: Schema.String, version: Schema.String, files: Schema.Array(Schema.String) }));
export interface BuiltConcord { readonly name: string; readonly version: string; readonly filename: string; readonly files: readonly { readonly path: string }[] }

/** Describe the current build. This never creates a tarball or installs a package. */
export function builtConcord(destination: string): BuiltConcord {
  return Effect.runSync(Effect.sync(() => {
    const root = destination;
    const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(applicationRoot(root), 'package.json'), 'utf8'));
    const visit = (path: string): { path: string }[] => {
      const entries = readdirSync(join(root, path), { withFileTypes: true });
      return entries.flatMap(entry => entry.isDirectory() ? visit(join(path, entry.name)) : [{ path: join(path, entry.name) }]);
    };
    const files = applicationRoot(root) !== root ? visit('').filter(file => !/^(?:\.concord-build-cache\.json|concord-.+\.tar\.gz(?:\.sha256)?)$/u.test(file.path)) : manifest.files.flatMap(path => existsSync(join(root, path))
      ? /\.[a-z]+$/u.test(path) ? [{ path }] : visit(path) : []);
    for (const name of readdirSync(root)) if (/^README(?:\..+)?\.md$/u.test(name) && !files.some(file => file.path === name)) files.push({ path: name });
    if (applicationRoot(root) === root) for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) if (!files.some(file => file.path === path)) files.push({ path });
    const result = { name: manifest.name, version: manifest.version, filename: root, files };
    return result;
  }));
}
/** Read-only consumers share this gate's package; damage fixtures own copied bytes. */
export function prepareSourceConsumer(directory: string, artifact: BuiltConcord, dependencies: readonly string[] = [], options: { private?: boolean } = {}): void {
  Effect.runSync(Effect.sync(() => {
    const modules = join(directory, 'node_modules'); mkdirSync(modules, { recursive: true });
    const target = join(modules, artifact.name);
    if (options.private) {
      cpSync(artifact.filename, target, { recursive: true, verbatimSymlinks: true });
    } else symlinkSync(artifact.filename, target, 'junction');
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
      writeFileSync(join(modules, '.bin/concord'), `#!/bin/sh\nexec ${packageCommand(cli).map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ')} "$@"\n`);
      chmodSync(join(modules, '.bin/concord'), 0o755);
    }
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(join(directory, 'package.json'), 'utf8'));
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ ...manifest, dependencies: { [artifact.name]: `file:${artifact.filename}`, ...Object.fromEntries(dependencies.map(dependency => [dependency.slice(0, dependency.lastIndexOf('@')), dependency.slice(dependency.lastIndexOf('@') + 1)])) } }, null, 2)}\n`);
  }));
}
