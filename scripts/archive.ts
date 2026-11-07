// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { cp, lstat, readlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ArchiveFailed, archiveTarget, attempt, run, sha256, type ArchiveTarget } from './archive-support.ts';
import { externalBuildOutput } from './build-output.ts';
import { prepareRuntime } from './archive-runtime.ts';
import { decodeNativeArtifact } from '../src/base/installation/hawdb-native-contract.ts';
import { archivePartInput, cachedArchivePart } from './application-cache.ts';
import { closeLinuxRuntime } from './archive-linux.ts';

export interface ArchiveOptions {
  readonly target?: unknown;
  readonly applicationRoot: string;
  readonly outputRoot: string;
  readonly repository?: string;
  readonly nativeArtifacts?: string;
  readonly linuxRuntimeLibraries?: string;
}
export const nativeTarget = (target: ArchiveTarget) => target === 'linux-x64' ? 'linux-x64-glibc' : target;
export const launcher = `#!/bin/sh
set -eu
self=$0
case "$self" in /*) ;; *) self=$PWD/$self ;; esac
while [ -L "$self" ]; do
  directory=$(CDPATH= cd -P "$(dirname "$self")" && pwd)
  link=$(readlink "$self")
  case "$link" in /*) self=$link ;; *) self=$directory/$link ;; esac
done
root=$(CDPATH= cd -P "$(dirname "$self")/.." && pwd)
if [ ! -x "$root/runtime/node" ]; then
  echo 'PackagedRuntimeUnavailable: bundled Node.js cannot run; on NixOS install Concord through the Nix channel.' >&2
  exit 1
fi
# platform-interpreter-check
exec "$root/runtime/node" "$root/app/dist/entry/cli/entry.js" "$@"
`;
export const archiveLauncher = (target: ArchiveTarget): string => launcher.replace('# platform-interpreter-check', target === 'linux-x64' ? `if [ ! -x /lib64/ld-linux-x86-64.so.2 ]; then
  echo 'PackagedRuntimeUnavailable: the Linux ELF interpreter is unavailable; on NixOS install Concord through the Nix channel.' >&2
  exit 1
fi` : '');

export const validateArchiveLinks = Effect.fn('archive.links')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of yield* fs.readDirectory(root, { recursive: true })) {
    const path = join(root, name);
    const stat = yield* attempt(() => lstat(path));
    if (!stat.isSymbolicLink()) continue;
    const target = yield* attempt(() => readlink(path));
    const canonical = yield* fs.realPath(path);
    const inside = relative(root, canonical);
    if (isAbsolute(target) || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) return yield* new ArchiveFailed({ message: `Archive link escapes root: ${name}` });
  }
});
export const installTargetDependencies = Effect.fn('archive.dependencies')(function*(app: string, target: ArchiveTarget) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(join(app, 'node_modules'), { recursive: true, force: true });
  const [os, cpu] = target.split('-');
  yield* run('pnpm', ['install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--optional', `--os=${os}`, `--cpu=${cpu}`, `--libc=${os === 'linux' ? 'glibc' : 'any'}`], app);
  // Both consumers need their optional platform executable despite ignored install scripts.
  for (const [scope, packageName, executable] of [['@esbuild', target, 'bin/esbuild'], ['@typescript', `typescript-${target}`, 'lib/tsc']] as const) {
    const store = join(app, 'node_modules/.pnpm');
    const directories = (yield* fs.readDirectory(store)).filter(name => name.startsWith(`${scope}+${packageName}@`));
    if (directories.length !== 1 || !(yield* fs.exists(join(store, directories[0]!, 'node_modules', scope, packageName, executable)))) return yield* new ArchiveFailed({ message: `Missing target executable: ${scope}/${packageName}/${executable}` });
  }
  // This optional package ships both libc flavors in one tarball. Its loader
  // selects tagged prebuilds; exclude musl images from our glibc-only archive.
  if (target === 'linux-x64') {
    const store = join(app, 'node_modules/.pnpm');
    for (const directory of (yield* fs.readDirectory(store)).filter(name => name.startsWith('@msgpackr-extract+msgpackr-extract-linux-x64@'))) {
      const folder = join(store, directory, 'node_modules/@msgpackr-extract/msgpackr-extract-linux-x64');
      if (!(yield* fs.exists(join(folder, 'node.napi.glibc.node')))) return yield* new ArchiveFailed({ message: 'Missing glibc msgpackr prebuild' });
      for (const name of yield* fs.readDirectory(folder)) if (name.endsWith('.musl.node')) yield* fs.remove(join(folder, name));
    }
  }
  yield* validateArchiveLinks(app);
});

const dependencyLicenses = Effect.fn('archive.licenses')(function*(root: string, modules = join(root, 'app/node_modules/.pnpm')) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of yield* fs.readDirectory(modules, { recursive: true })) {
    if (!/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].*)?$/iu.test(basename(name))) continue;
    const source = join(modules, name);
    if ((yield* fs.stat(source)).type !== 'File') continue;
    const destination = join(root, 'licenses/dependencies', name);
    yield* fs.makeDirectory(dirname(destination), { recursive: true });
    yield* fs.copyFile(source, destination);
  }
});

/** Reuses one target-independent application build for any number of targets. */
export const assembleArchive = Effect.fn('archive.assemble')(function*(options: ArchiveOptions) {
  // Decode before mkdir/remove or any other output mutation.
  const assemblyStarted = performance.now();
  let previousPhase = assemblyStarted;
  const phase = (name: string) => Effect.sync(() => {
    const now = performance.now();
    console.error(`# Archive assembly ${name}: ${((now - previousPhase) / 1000).toFixed(3)}s; elapsed=${((now - assemblyStarted) / 1000).toFixed(3)}s`);
    previousPhase = now;
  });
  const target = yield* Effect.try({ try: () => archiveTarget(options.target), catch: cause => cause });
  const fs = yield* FileSystem.FileSystem;
  const repository = resolve(options.repository ?? import.meta.dirname, options.repository ? '.' : '..');
  const output = yield* externalBuildOutput(options.outputRoot);
  const application = resolve(options.applicationRoot);
  if (output === application || application.startsWith(output + sep) || output.startsWith(application + sep)) return yield* new ArchiveFailed({ message: 'Application and archive outputs must be disjoint' });
  yield* fs.makeDirectory(dirname(output), { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: dirname(output), prefix: '.archive-' });
  const root = join(staging, 'root');
  yield* fs.makeDirectory(root);
  yield* fs.copy(application, join(root, 'app'));
  const app = join(root, 'app');
  yield* fs.remove(join(app, '.application-cache.json'), { force: true });
  const dependencyInput = () => archivePartInput(repository,
    ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/archive.ts', 'scripts/archive-support.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts'],
    { target, pnpm: process.env.npm_config_user_agent ?? '' });
  const dependencies = yield* cachedArchivePart('dependencies', yield* dependencyInput(), directory => Effect.gen(function*() {
    yield* fs.makeDirectory(directory, { recursive: true });
    for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) yield* fs.copyFile(join(repository, file), join(directory, file));
    yield* installTargetDependencies(directory, target);
    yield* dependencyLicenses(directory, join(directory, 'node_modules/.pnpm'));
  }), dependencyInput);
  // Effect's copy resolves symlink targets. pnpm links must retain their exact
  // relative text when moving a readonly dependency part into a private tree.
  yield* attempt(() => cp(join(dependencies, 'node_modules'), join(app, 'node_modules'), { recursive: true, verbatimSymlinks: true }));

  yield* phase('application-and-dependencies');
  const native = join(app, 'dist/native');
  yield* fs.remove(native, { recursive: true, force: true });
  const sources = options.nativeArtifacts ?? process.env.CONCORD_NATIVE_ARTIFACTS;
  const prepared = join(staging, 'native');
  yield* run(process.execPath, ['scripts/prepare-native.ts', '--target', nativeTarget(target), '--output', prepared, ...(sources ? ['--prebuilt', sources] : [])], repository);
  const folder = join(prepared, nativeTarget(target));
  if (!(yield* fs.exists(folder))) return yield* new ArchiveFailed({ message: `Missing prebuilt native target ${target}; cross compilation is not implicit` });
  const metadata = yield* fs.readFileString(join(folder, 'artifact.json'));
  const artifact = yield* Effect.try({ try: () => decodeNativeArtifact(JSON.parse(metadata)), catch: cause => cause });
  if (!artifact.portable || artifact.testHooks) return yield* new ArchiveFailed({ message: `Native artifact is not portable: ${target}; provide the Ubuntu 24.04/macOS native job artifact` });
  // The prepare-native entry verifies source/lock/license identity before copying.
  yield* fs.makeDirectory(native, { recursive: true });
  yield* fs.copy(folder, join(native, nativeTarget(target)));
  yield* phase('native');
  const runtimeInput = () => Effect.gen(function*() {
    const signed = target === 'darwin-arm64' && sources !== undefined
      ? yield* archivePartInput(resolve(sources), [target]) : null;
    return yield* archivePartInput(repository, ['.node-version', 'runtime-deps.json', 'scripts/archive-runtime.ts', 'scripts/archive-support.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts'], { target, signed });
  });
  const runtime = yield* cachedArchivePart('runtime', yield* runtimeInput(), directory => prepareRuntime(directory, repository, target, sources), runtimeInput);
  for (const name of ['runtime', 'licenses']) yield* fs.copy(join(runtime, name), join(root, name));

  yield* fs.makeDirectory(join(root, 'bin'));
  yield* fs.writeFileString(join(root, 'bin/concord'), archiveLauncher(target));
  yield* fs.chmod(join(root, 'bin/concord'), 0o755);
  if (yield* fs.exists(join(dependencies, 'licenses'))) yield* fs.copy(join(dependencies, 'licenses'), join(root, 'licenses'), { overwrite: true });
  yield* phase('runtime-and-licenses');
  if (target === 'linux-x64') yield* closeLinuxRuntime(root, options.linuxRuntimeLibraries ?? process.env.CONCORD_LINUX_RUNTIME_LIBRARIES);
  yield* phase('target-closure');
  yield* validateArchiveLinks(root);
  yield* phase('link-validation');
  const pkg = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ name: Schema.Literal('concord-sdlc'), version: Schema.String })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(app, 'package.json')));
  const filename = `concord-${pkg.version}-${target}.tar.gz`;
  const archive = join(staging, filename);
  yield* run('tar', [...(process.platform === 'linux' ? ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner'] : []), '-czf', archive, '-C', root, 'bin', 'runtime', 'licenses', 'app']);
  yield* phase('compression');
  const digest = sha256(yield* fs.readFile(archive));
  yield* fs.copyFile(archive, join(root, filename));
  yield* fs.writeFileString(join(root, `${filename}.sha256`), `${digest}  ${filename}\n`);
  yield* fs.remove(output, { recursive: true, force: true });
  yield* fs.rename(root, output);
  return { target, root: output, applicationRoot: join(output, 'app'), filename: join(output, filename), sha256: digest, version: pkg.version };
}, Effect.scoped);
