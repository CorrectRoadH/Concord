// @concord-file
// @concord-implements docs/engineering/build/architecture.md#共享构建缓存
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { acquireRecoverablePublicationLease, CoordinationError, ownerIsAlive, readLeaseOwner, releaseFileLease, type FileLease } from '../src/base/publication/file-lease.ts';
import { decodeNativeArtifact, HAWDB_ABI, HAWDB_REVISION } from '../src/base/installation/hawdb-native-contract.ts';
import { readNativeRelease } from '../src/base/installation/native-release.ts';
import { archiveTarget } from './archive-support.ts';
import { BuildIdentity } from './build-identity.ts';

export class GateBuildCacheFailed extends Schema.TaggedError<GateBuildCacheFailed>()('GateBuildCacheFailed', { message: Schema.String }) {}
const fail = (cause: unknown) => new GateBuildCacheFailed({ message: String(cause) });
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const inspect = (path: string) => Effect.tryPromise({ try: () => lstat(path), catch: fail });
const linkText = (path: string) => Effect.tryPromise({ try: () => readlink(path), catch: fail });
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const Manifest = Schema.Struct({
  format: Schema.Literal('concord.gate-build/v1'), digest: Digest,
  entries: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(['file', 'link', 'directory']), mode: Schema.Number, digest: Digest })),
});
const manifestName = '.concord-build-cache.json';
export const gateBuildCacheRoot = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'build');

/** Hash file bytes and link destinations, without following directory links. */
export const buildCacheTree = Effect.fn('gate.cache.tree')(function*(root: string, exclude: (path: string) => boolean = () => false, followLinks = false) {
  const fs = yield* FileSystem.FileSystem;
  const entries: { path: string; kind: 'file' | 'link' | 'directory'; mode: number; digest: string }[] = [];
  const walk = (directory: string, ancestors: readonly string[] = []): Effect.Effect<void, unknown, FileSystem.FileSystem> => Effect.gen(function*() {
    const canonical = yield* fs.realPath(join(root, directory));
    if (ancestors.includes(canonical)) return yield* new GateBuildCacheFailed({ message: `Cyclic build input link: ${directory}` });
    for (const name of (yield* fs.readDirectory(join(root, directory))).sort()) {
      const path = directory ? `${directory}/${name}` : name;
      if (exclude(path)) continue;
      const full = join(root, path), stat = yield* inspect(full);
      if (stat.isSymbolicLink()) {
        entries.push({ path, kind: 'link', mode: stat.mode & 0o777, digest: sha(yield* linkText(full)) });
        if (followLinks) {
          const target = yield* fs.stat(full);
          if (target.type === 'Directory') yield* walk(path, [...ancestors, canonical]);
          else entries.push({ path, kind: 'file', mode: (yield* inspect(yield* fs.realPath(full))).mode & 0o777, digest: sha(yield* fs.readFile(full)) });
        }
      }
      else if (stat.isDirectory()) {
        entries.push({ path, kind: 'directory', mode: stat.mode & 0o777, digest: sha('') });
        yield* walk(path, [...ancestors, canonical]);
      }
      else if (stat.isFile()) entries.push({ path, kind: 'file', mode: stat.mode & 0o777, digest: sha(yield* fs.readFile(full)) });
      else return yield* new GateBuildCacheFailed({ message: `Unsupported build entry: ${full}` });
    }
  });
  yield* walk('');
  return entries;
});

const nativeInputCache = Effect.fn('gate.cache.nativeInput')(function*(checkout: string) {
  const release = yield* Effect.try({ try: () => readNativeRelease(checkout), catch: fail });
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'native', release.tag);
});

export const gateBuildDigest = Effect.fn('gate.cache.digest')(function*(checkout: string, includeNative = true) {
  const target = includeNative ? archiveTarget() : undefined;
  const fs = yield* FileSystem.FileSystem;
  // The build owns these trees (including its copied resources). File discovery,
  // rather than a second list of source files, includes new and untracked bytes.
  const roots = new Set(['src', 'web', 'scripts', 'docs', 'templates', 'skills', 'patches']);
  const inputs = (yield* fs.readDirectory(checkout)).filter(name => roots.has(name)
    || name === '.bun-version' || name === '.node-version' || name === 'runtime-deps.json' || name === 'native-release.json'
    || /^(?:README(?:\..+)?\.md|package\.json|pnpm[^/]*\.yaml|tsconfig[^/]*\.json|vite[^/]*\.config\.ts)$/u.test(name));
  const entries = yield* buildCacheTree(checkout, path => {
    const parts = path.split('/');
    return !inputs.includes(parts[0]!) || parts.includes('node_modules') || parts.includes('.git');
  }, true);
  const compiler = (yield* fs.exists(join(checkout, 'scripts/distribution.ts')))
    ? yield* Effect.promise(() => import('./compile-application.ts')).pipe(Effect.flatMap(module => module.bunCompilerIdentity(checkout, target ?? archiveTarget()))) : null;
  if (!includeNative) return sha(JSON.stringify({ entries, node: process.version, bun: process.versions.bun ?? null, compiler }));
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const commit = yield* spawner.string(ChildProcess.make('git', ['-C', checkout, 'rev-parse', 'HEAD'], { stderr: 'ignore' })).pipe(Effect.map(value => value.trim()), Effect.catch(() => Effect.succeed(null)));
  const libraryDirectory = process.env.CONCORD_LINUX_RUNTIME_LIBRARIES;
  const linuxLibraries = libraryDirectory !== undefined ? yield* buildCacheTree(resolve(libraryDirectory), undefined, true)
    : target === 'linux-x64' && (yield* fs.exists(join(checkout, 'scripts/archive-linux.ts')))
      ? yield* Effect.promise(() => import('./archive-linux.ts')).pipe(Effect.flatMap(module => module.ubuntuRuntimeMetadata())) : null;
  const prebuilt = process.env.CONCORD_NATIVE_ARTIFACTS;
  const tools = (yield* fs.exists(join(checkout, 'scripts/distribution.ts')))
    ? yield* Effect.forEach(process.platform === 'linux' ? ['bun', 'pnpm', 'tar', 'patchelf', 'readelf'] : ['bun', 'pnpm', 'tar'], tool =>
      spawner.string(ChildProcess.make(tool, ['--version'], { stderr: 'ignore' })).pipe(Effect.map(version => ({ tool, version })))) : [];
  if (process.platform === 'darwin' && tools.length > 0) tools.push({ tool: 'codesign', version: sha(yield* fs.readFile('/usr/bin/codesign')) });
  const cachedNative = join(yield* nativeInputCache(checkout), target === 'linux-x64' ? 'linux-x64-glibc' : target!);
  const native = prebuilt !== undefined ? yield* buildCacheTree(resolve(prebuilt), undefined, true)
    : (yield* fs.exists(cachedNative)) ? yield* buildCacheTree(cachedNative, undefined, true) : null;
  return sha(JSON.stringify({ entries, platform: process.platform, arch: process.arch, node: process.version,
    abi: process.versions.modules, bun: process.versions.bun ?? null, cpu: target === 'linux-x64' ? 'bun-linux-x64-baseline' : 'bun-darwin-arm64', target, nativeAbi: HAWDB_ABI, nativeRevision: HAWDB_REVISION,
    requirePortableNative: process.env.CONCORD_REQUIRE_PORTABLE_NATIVE ?? '', commit, linuxLibraries, native, tools, compiler }));
});

// Reuse Concord's atomic, token-owned file lease. Recovery removes only the
// observed dead owner's token; an arriving live owner can never be unlinked.
const lock = Effect.fn('gate.cache.lock')(function*(cache: string, directory: string) {
  for (;;) {
    const lease = yield* Effect.try({
      try: () => acquireRecoverablePublicationLease(cache, directory, 'publication.lease', 'exclusive', 'gate-build-cache')!,
      catch: cause => cause,
    }).pipe(Effect.catch(cause => cause instanceof CoordinationError && cause.reason === 'occupied'
      ? Effect.succeed(undefined) : Effect.fail(fail(cause))));
    if (lease) return lease;
    yield* Effect.sleep('25 millis');
  }
});
const unlock = (lease: FileLease) => Effect.sync(() => releaseFileLease(lease, 'gate-build-cache'));
const withLock = <A, E, R>(cache: string, directory: string, body: Effect.Effect<A, E, R>) =>
  Effect.scoped(Effect.gen(function*() {
    yield* Effect.acquireRelease(lock(cache, directory), unlock);
    return yield* body;
  }));

const validatePackage = Effect.fn('gate.cache.validatePackage')(function*(archiveRoot: string, checkout: string) {
  const root = join(archiveRoot, 'app');
  const fs = yield* FileSystem.FileSystem;
  const pkg = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({
    name: Schema.String, bin: Schema.Struct({ concord: Schema.String }), dependencies: Schema.Record(Schema.String, Schema.String),
  })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(root, 'package.json')));
  const archiveFiles = (yield* fs.readDirectory(archiveRoot)).filter(name => /^concord-.+-(?:linux-x64|darwin-arm64)\.tar\.gz$/u.test(name));
  if (archiveFiles.length !== 1) return yield* new GateBuildCacheFailed({ message: 'Expected one complete target archive' });
  const filename = archiveFiles[0]!;
  const checksum = (yield* fs.readFileString(join(archiveRoot, filename + '.sha256'))).trim();
  if (checksum !== `${sha(yield* fs.readFile(join(archiveRoot, filename)))}  ${filename}`) return yield* new GateBuildCacheFailed({ message: 'Archive SHA-256 validation failed' });
  for (const path of ['bin/concord', 'runtime/rg', 'licenses/BUN-LICENSE.md']) {
    if (!(yield* inspect(join(archiveRoot, path))).isFile() || (yield* fs.readFile(join(archiveRoot, path))).length === 0) return yield* new GateBuildCacheFailed({ message: `Missing archive file: ${path}` });
  }
  if (yield* fs.exists(join(archiveRoot, 'runtime/node'))) return yield* new GateBuildCacheFailed({ message: 'Archive must not contain a separate JS interpreter' });
  for (const name of ['entry', 'app', 'base', 'domain', 'model']) {
    if (yield* fs.exists(join(root, 'dist', name))) return yield* new GateBuildCacheFailed({ message: `Archive must not contain application modules: dist/${name}` });
  }
  const required = ['dist/compiler.json', 'dist/web/index.html', 'dist/preview/index.html', 'dist/herdr-mod/main.js',
    'dist/herdr-mod/mod.json', 'dist/herdr-mod/preview.png', 'dist/build-identity.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
  for (const path of required) {
    if (!(yield* inspect(join(root, path))).isFile() || (yield* fs.readFile(join(root, path))).length === 0) return yield* new GateBuildCacheFailed({ message: `Missing package file: ${path}` });
  }
  yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BuildIdentity), { onExcessProperty: 'error' })(yield* fs.readFileString(join(root, 'dist/build-identity.json')));
  for (const directory of ['web', 'preview']) {
    const html = yield* fs.readFileString(join(root, 'dist', directory, 'index.html'));
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gu)) {
      const asset = match[1]!.split(/[?#]/u)[0]!;
      if (!asset || /^(?:[a-z]+:|\/\/|#)/iu.test(asset)) continue;
      const path = resolve(root, 'dist', directory, asset.replace(/^\//u, ''));
      const inside = relative(join(root, 'dist', directory), path);
      if (inside === '..' || inside.startsWith(`..${sep}`) || !(yield* fs.exists(path))) return yield* new GateBuildCacheFailed({ message: `Missing Web asset: ${asset}` });
    }
  }
  for (const directory of ['docs', 'templates', 'skills', 'dist/p5-types']) {
    if ((yield* fs.readDirectory(join(root, directory))).length === 0) return yield* new GateBuildCacheFailed({ message: `Empty package resources: ${directory}` });
  }
  for (const dependency of Object.keys(pkg.dependencies)) {
    if (!(yield* fs.exists(join(root, 'node_modules', dependency, 'package.json')))) return yield* new GateBuildCacheFailed({ message: `Missing runtime dependency: ${dependency}` });
  }
  const target = archiveTarget();
  if (!filename.endsWith(`-${target}.tar.gz`)) return yield* new GateBuildCacheFailed({ message: 'Archive target differs from requested build target' });
  const expectedNativeTarget = target === 'linux-x64' ? 'linux-x64-glibc' : target;
  const native = join(root, 'dist/native', expectedNativeTarget);
  const metadata = yield* fs.readFileString(join(native, 'artifact.json'));
  const artifact = yield* Effect.try({ try: () => decodeNativeArtifact(JSON.parse(metadata)), catch: fail });
  const release = yield* Effect.try({ try: () => readNativeRelease(checkout), catch: fail });
  if (artifact.target !== expectedNativeTarget || artifact.testHooks || process.env.CONCORD_REQUIRE_PORTABLE_NATIVE === '1' && !artifact.portable || artifact.sourceDigest !== release.sourceDigest
    || artifact.cargoLockDigest !== release.cargoLockDigest
    || artifact.binarySha256 !== sha(yield* fs.readFile(join(native, 'hawdb.node')))
    || artifact.noticesSha256 !== sha(yield* fs.readFile(join(native, 'THIRD-PARTY-NOTICES.txt')))) {
    return yield* new GateBuildCacheFailed({ message: 'Native package identity differs from build inputs' });
  }
  const entries = yield* buildCacheTree(archiveRoot, path => path === manifestName || path === '.in-use' || path.startsWith('.in-use/'));
  for (const entry of entries) {
    if (entry.kind !== 'link') continue;
    const full = join(archiveRoot, entry.path), target = yield* linkText(full);
    const canonical = yield* fs.realPath(full);
    const inside = relative(archiveRoot, canonical);
    if (isAbsolute(target) || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
      return yield* new GateBuildCacheFailed({ message: `Package link is not relocatable: ${entry.path}` });
    }
  }
  return entries;
});

const validatePublished = Effect.fn('gate.cache.validatePublished')(function*(root: string, checkout: string, digest: string) {
  const fs = yield* FileSystem.FileSystem;
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest), { onExcessProperty: 'error' })(yield* fs.readFileString(join(root, manifestName)));
  const entries = yield* validatePackage(root, checkout);
  if (manifest.digest !== digest || JSON.stringify(manifest.entries) !== JSON.stringify(entries)) {
    return yield* new GateBuildCacheFailed({ message: `Published package failed integrity validation: ${root}` });
  }
});

/** Admission, last-use updates and prune share one short, recoverable lease. */
const control = (cache: string) => join(cache, '.control');
const prune = Effect.fn('gate.cache.prune')(function*(cache: string) {
  const fs = yield* FileSystem.FileSystem;
  const directories = (yield* fs.readDirectory(cache)).filter(name => /^[a-f0-9]{64}$/u.test(name));
  const used: { digest: string; time: number }[] = [];
  for (const digest of directories) {
    const source = yield* fs.readFileString(join(cache, '.access', digest)).pipe(Effect.catch(() => Effect.succeed('0')));
    const time = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)(source);
    used.push({ digest, time });
  }
  used.sort((a, b) => b.time - a.time || a.digest.localeCompare(b.digest));
  for (const { digest } of used.slice(4)) {
    const directory = join(cache, '.leases', digest);
    let active = false;
    if (yield* fs.exists(directory)) {
      for (const name of yield* fs.readDirectory(directory)) {
        const owner = yield* Effect.try({ try: () => readLeaseOwner(join(directory, name, 'publication.lease'), 'gate-cache-prune'), catch: fail });
        if (owner && (yield* Effect.try({ try: () => ownerIsAlive(owner), catch: fail }))) { active = true; break; }
      }
    }
    if (active) continue;
    yield* fs.remove(join(cache, digest), { recursive: true, force: true });
    yield* fs.remove(join(cache, '.access', digest), { force: true });
    yield* fs.remove(directory, { recursive: true, force: true });
  }
});

/** Allocate a stable package path before scheduling source tests. The caller's
 * scope retains its cross-process lease until every gate sibling has finished. */
export const prepareGateBuildCache = Effect.fn('gate.cache.prepare')(function*(checkout: string, cache = gateBuildCacheRoot()) {
  archiveTarget(); // Reject unsupported targets before any cache output is written.
  const fs = yield* FileSystem.FileSystem;
  checkout = yield* fs.realPath(resolve(checkout));
  cache = resolve(cache);
  const isInside = (path: string) => { const inside = relative(checkout, path); return inside === '' || inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside); };
  if (isInside(cache)) {
    return yield* new GateBuildCacheFailed({ message: 'Gate build cache must be outside the checkout' });
  }
  yield* fs.makeDirectory(cache, { recursive: true });
  cache = yield* fs.realPath(cache);
  if (isInside(cache)) return yield* new GateBuildCacheFailed({ message: 'Gate build cache resolves inside the checkout' });
  if (process.env.CONCORD_NATIVE_ARTIFACTS === undefined && (yield* fs.exists(join(checkout, 'scripts/distribution.ts')))) {
    const target = archiveTarget();
    const native = join(yield* nativeInputCache(checkout), target === 'linux-x64' ? 'linux-x64-glibc' : target);
    if (!(yield* fs.exists(native))) {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const code = yield* spawner.exitCode(ChildProcess.make(process.execPath, ['scripts/prepare-native.ts', '--all-modes'], { cwd: checkout, stdout: 'inherit', stderr: 'inherit' }));
      if (Number(code) !== 0) return yield* new GateBuildCacheFailed({ message: `Native preparation exited ${code}` });
    }
  }
  const digest = yield* gateBuildDigest(checkout);
  const packageRoot = join(cache, digest);
  const leaseDirectory = join(cache, '.leases', digest, randomUUID());
  yield* Effect.acquireRelease(withLock(cache, control(cache), Effect.gen(function*() {
    yield* fs.makeDirectory(join(cache, '.access'), { recursive: true });
    const lease = yield* lock(cache, leaseDirectory);
    yield* fs.writeFileString(join(cache, '.access', digest), String(Date.now()));
    return lease;
  })), lease => withLock(cache, control(cache), Effect.gen(function*() {
    yield* unlock(lease);
    yield* fs.remove(leaseDirectory, { recursive: true, force: true });
    yield* prune(cache);
  })).pipe(Effect.orDie));

  const build = (compile: (output: string) => Effect.Effect<number, unknown, ChildProcessSpawner.ChildProcessSpawner>) =>
    withLock(cache, join(cache, '.builders', digest), Effect.gen(function*() {
      if (yield* fs.exists(packageRoot)) {
        yield* validatePublished(packageRoot, checkout, digest);
        if ((yield* gateBuildDigest(checkout)) !== digest) return yield* new GateBuildCacheFailed({ message: 'Build inputs changed while validating the cache; run the gate again' });
        return { cache: 'hit' as const, builds: 0, digest, packageRoot };
      }
      // An exited builder has no publication authority. Its private staging
      // directories cannot be observed by tests and are safe to discard.
      for (const name of yield* fs.readDirectory(cache)) {
        if (name.startsWith(`.staging-${digest}-`)) yield* fs.remove(join(cache, name), { recursive: true, force: true });
      }
      const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: `.staging-${digest}-` });
      const output = join(staging, 'package');
      const code = yield* compile(output);
      if (code !== 0) return yield* new GateBuildCacheFailed({ message: `vp build exited ${code}; package not published` });
      const entries = yield* validatePackage(output, checkout);
      if ((yield* gateBuildDigest(checkout)) !== digest) return yield* new GateBuildCacheFailed({ message: 'Build inputs changed during compilation; package not published. Run the gate again.' });
      yield* fs.writeFileString(join(output, manifestName), JSON.stringify({ format: 'concord.gate-build/v1', digest, entries }));
      yield* withLock(cache, control(cache), Effect.gen(function*() {
        yield* fs.rename(output, packageRoot);
        yield* fs.writeFileString(join(cache, '.access', digest), String(Date.now()));
        yield* prune(cache);
      }));
      return { cache: 'miss' as const, builds: 1, digest, packageRoot };
    }));
  return { digest, packageRoot, build };
});
