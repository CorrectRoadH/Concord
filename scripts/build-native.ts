import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Console, Effect, FileSystem, Schema, Stream, type PlatformError } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/unstable/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_TARGETS, HAWDB_MACOS_DEPLOYMENT_TARGET, decodeNativeArtifact, hawdbTarget, type NativeArtifact } from "../src/base/installation/index.ts";

import { nativeSourceDigest, nativeCacheRoot } from "../src/base/installation/index.ts";

const root = resolve(import.meta.dirname, '..');
const crate = join(root, 'native/hawdb');
const hash = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
const digestSources = nativeSourceDigest;
class NativeBuildFailed extends Schema.TaggedError<NativeBuildFailed>()('NativeBuildFailed', { detail: Schema.String }) {
  override get message(): string { return this.detail; }
}
const buildFailure = (cause: unknown) => new NativeBuildFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
// FileSystem.stat follows symlinks; artifact and license boundaries must not.
const inspectEntry = (path: string) => Effect.tryPromise({ try: () => lstat(path), catch: buildFailure });
const shaFile = Effect.fn('native.shaFile')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return hash(yield* fs.readFile(path));
});
const commandOutput = Effect.fn('native.commandOutput')(function*(command: string, args: readonly string[], limit = 1024 * 1024) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(command, args, { stderr: 'inherit' }));
  let bytes = 0;
  const stdout = child.stdout.pipe(Stream.mapEffect(chunk => {
    bytes += chunk.byteLength;
    return bytes > limit ? Effect.fail(new NativeBuildFailed({ detail: `${command} output exceeds ${limit} bytes` })) : Effect.succeed(chunk);
  }), Stream.decodeText(), Stream.mkString);
  const [text, code] = yield* Effect.all([stdout, child.exitCode], { concurrency: 'unbounded' });
  if (code !== 0) return yield* new NativeBuildFailed({ detail: `${command} exited ${code}` });
  return text;
}, Effect.scoped);
const CargoMetadataSchema = Schema.Struct({ packages: Schema.Array(Schema.Struct({
  name: Schema.String, version: Schema.String, license: Schema.NullOr(Schema.String),
  manifest_path: Schema.String, source: Schema.NullOr(Schema.String),
})) });
const LicenseDigests = Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String }));
const licenseMarker = 'Concord license file digests:';
const licenseDigests = Effect.fn('native.licenseDigests')(function*(folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = ['HAWDB-LICENSE.txt', 'UPSTREAM.txt'];
  const visit = Effect.fn('native.visitLicenseDirectory')(function*(directory: string): Effect.fn.Return<void, NativeBuildFailed | PlatformError.PlatformError, FileSystem.FileSystem> {
    for (const name of yield* fs.readDirectory(join(folder, directory))) {
      const path = `${directory}/${name}`;
      const entry = yield* inspectEntry(join(folder, path));
      if (entry.isDirectory()) yield* visit(path);
      else if (entry.isFile()) files.push(path);
      else return yield* new NativeBuildFailed({ detail: `native license must be a regular file: ${path}` });
    }
  });
  yield* visit('licenses');
  return yield* Effect.all(files.sort().map(path => shaFile(join(folder, path)).pipe(Effect.map(sha256 => ({ path, sha256 })))));
});
// FileSystem.copy has no recursive dereference option; Cargo license trees use
// the resolved file bytes, not links into the compiler's registry directory.
const copyLicense = Effect.fn('native.copyLicense')(function*(source: string, destination: string): Effect.fn.Return<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  const resolved = yield* fs.realPath(source);
  if ((yield* fs.stat(resolved)).type === 'Directory') {
    yield* fs.makeDirectory(destination, { recursive: true });
    for (const name of yield* fs.readDirectory(resolved)) yield* copyLicense(join(resolved, name), join(destination, name));
  } else yield* fs.copyFile(resolved, destination);
});
const dependencyNotices = Effect.fn('native.dependencyNotices')(function*(dest: string) {
  const fs = yield* FileSystem.FileSystem;
  const metadata = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CargoMetadataSchema), { onExcessProperty: 'ignore' })(yield* commandOutput('cargo', [
    '+1.97.1', 'metadata', '--locked', '--format-version=1', '--manifest-path', join(crate, 'Cargo.toml'),
  ], 32 * 1024 * 1024));
  const lines = ['Pinned Cargo dependency licenses; see licenses/ for distributed license and notice files.', ''];
  for (const pkg of [...metadata.packages].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
    if (pkg.source === null || pkg.source.startsWith('git+')) continue; // HawDB and its crates use HAWDB-LICENSE.txt.
    if (!pkg.license) return yield* new NativeBuildFailed({ detail: `dependency has no license declaration: ${pkg.name}@${pkg.version}` });
    const id = `${pkg.name}-${pkg.version}`;
    lines.push(`${id} | ${pkg.license} | ${pkg.source}`);
    const packageDir = resolve(pkg.manifest_path, '..');
    const files = (yield* fs.readDirectory(packageDir)).filter(name => /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].*)?$/iu.test(name));
    if (files.length > 0) {
      const licenseDir = join(dest, 'licenses', id);
      yield* fs.makeDirectory(licenseDir, { recursive: true });
      for (const name of files) yield* copyLicense(join(packageDir, name), join(licenseDir, name));
    }
  }
  lines.push('', licenseMarker, JSON.stringify(yield* licenseDigests(dest)));
  yield* fs.writeFileString(join(dest, 'THIRD-PARTY-NOTICES.txt'), `${lines.join('\n')}\n`);
});
const ArgsSchema = Schema.Struct({ output: Schema.String, prebuilt: Schema.optional(Schema.String), requirePortable: Schema.Boolean, testHooks: Schema.Boolean, reuse: Schema.Boolean });
function parseArgs(argv: readonly string[]): Schema.Schema.Type<typeof ArgsSchema> {
  const result: { output: string; prebuilt?: string; requirePortable: boolean; testHooks: boolean; reuse: boolean } = { output: nativeCacheRoot(), requirePortable: false, testHooks: false, reuse: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--output' && argv[i + 1]) result.output = argv[++i]!;
    else if (value === '--prebuilt' && argv[i + 1]) result.prebuilt = argv[++i]!;
    else if (value === '--require-portable') result.requirePortable = true;
    else if (value === '--reuse') result.reuse = true;
    else if (value === '--test-hooks') result.testHooks = true;
    else throw new Error(`unknown or incomplete native build argument: ${value}`);
  }
  return Schema.decodeUnknownSync(ArgsSchema, { onExcessProperty: 'error' })(result);
}
const validateArtifact = Effect.fn('native.validateArtifact')(function*(folder: string, target: string, requirePortable: boolean) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt', 'HAWDB-LICENSE.txt', 'UPSTREAM.txt']) {
    if (!(yield* inspectEntry(join(folder, name))).isFile()) return yield* new NativeBuildFailed({ detail: `native artifact must be a regular file: ${name}` });
  }
  const metadata = yield* fs.readFileString(join(folder, 'artifact.json'));
  const artifact = yield* Effect.try({ try: () => decodeNativeArtifact(JSON.parse(metadata)), catch: buildFailure });
  if (artifact.target !== target || artifact.abi !== HAWDB_ABI || artifact.revision !== HAWDB_REVISION) return yield* new NativeBuildFailed({ detail: `native identity mismatch: ${folder}` });
  if (artifact.sourceDigest !== (yield* Effect.sync(digestSources)) || artifact.cargoLockDigest !== (yield* shaFile(join(crate, 'Cargo.lock')))) return yield* new NativeBuildFailed({ detail: `native source/lock mismatch: ${folder}` });
  if (artifact.binarySha256 !== (yield* shaFile(join(folder, 'hawdb.node')))) return yield* new NativeBuildFailed({ detail: `native binary digest mismatch: ${folder}` });
  if (artifact.noticesSha256 !== (yield* shaFile(join(folder, 'THIRD-PARTY-NOTICES.txt')))) return yield* new NativeBuildFailed({ detail: `native dependency notices mismatch: ${folder}` });
  const noticeLines = (yield* fs.readFileString(join(folder, 'THIRD-PARTY-NOTICES.txt'))).trimEnd().split('\n');
  if (noticeLines.at(-2) !== licenseMarker) return yield* new NativeBuildFailed({ detail: `native license digests missing: ${folder}` });
  const expectedLicenses = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LicenseDigests), { onExcessProperty: 'error' })(noticeLines.at(-1));
  if (JSON.stringify(expectedLicenses) !== JSON.stringify(yield* licenseDigests(folder))) return yield* new NativeBuildFailed({ detail: `native license digest mismatch: ${folder}` });
  for (const name of ['HAWDB-LICENSE.txt', 'UPSTREAM.txt']) {
    if ((yield* shaFile(join(folder, name))) !== (yield* shaFile(join(crate, name)))) return yield* new NativeBuildFailed({ detail: `native source notice mismatch: ${name}` });
  }
  if (target === 'darwin-arm64' && artifact.deploymentTarget !== HAWDB_MACOS_DEPLOYMENT_TARGET) return yield* new NativeBuildFailed({ detail: `native deployment target mismatch: ${folder}` });
  if (requirePortable && artifact.testHooks) return yield* new NativeBuildFailed({ detail: `test-hook native artifact cannot ship: ${folder}` });
  if (requirePortable && !artifact.portable) return yield* new NativeBuildFailed({ detail: `native artifact is not portable: ${folder}` });
  return artifact;
});
const portableLinkage = Effect.fn('native.portableLinkage')(function*(binary: string, target: string) {
  if (target === 'darwin-arm64') {
    const loadCommands = yield* commandOutput('otool', ['-l', binary]);
    const identity = (yield* commandOutput('otool', ['-D', binary])).trim().split('\n').at(-1)?.trim();
    const minimum = /\bminos\s+(\d+\.\d+)(?:\s|$)/u.exec(loadCommands)?.[1];
    return process.env.MACOSX_DEPLOYMENT_TARGET === HAWDB_MACOS_DEPLOYMENT_TARGET && minimum === HAWDB_MACOS_DEPLOYMENT_TARGET && identity === '@rpath/hawdb.node';
  }
  const dependencies = yield* commandOutput('ldd', [binary]);
  const glibc = (yield* commandOutput('getconf', ['GNU_LIBC_VERSION'])).trim().match(/^glibc (\d+)\.(\d+)$/u);
  return !dependencies.includes('/nix/store/') && !dependencies.includes('not found') && !!glibc && Number(glibc[1]) === 2 && Number(glibc[2]) <= 39;
}, Effect.catch(() => Effect.succeed(false)));
class NativeReuseFailed extends Schema.TaggedError<NativeReuseFailed>()('NativeReuseFailed', { detail: Schema.String }) {}
const reuseFailure = (cause: unknown) => new NativeReuseFailed({ detail: cause instanceof NativeBuildFailed || cause instanceof NativeReuseFailed ? cause.detail : cause instanceof Error ? cause.message : String(cause) });
const reason = (source: string, cause: unknown) => {
  const detail = cause instanceof NativeReuseFailed ? cause.detail : String(cause);
  return Console.error(`# Native ${source}: ${detail.replace(/\s+/gu, ' ')}; falling back`);
};

const installArtifact = Effect.fn('native.installArtifact')(function*(source: string, destination: string) {
  const fs = yield* FileSystem.FileSystem;
  if (resolve(source) === resolve(destination)) return;
  yield* fs.makeDirectory(dirname(destination), { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: dirname(destination), prefix: '.native-copy-' });
  const staged = join(staging, 'artifact');
  yield* fs.copy(source, staged);
  yield* fs.makeDirectory(destination, { recursive: true });
  // Never truncate a native image which another process may have mapped.
  yield* fs.rename(join(staged, 'hawdb.node'), join(destination, 'hawdb.node'));
  for (const name of yield* fs.readDirectory(staged)) yield* fs.copy(join(staged, name), join(destination, name), { overwrite: true });
}, Effect.scoped);

const copyArtifact = Effect.fn('native.copyArtifact')(function*(input: string, output: string, target: string) {
  const artifact = yield* validateArtifact(join(input, target), target, false);
  if (artifact.testHooks) return yield* new NativeBuildFailed({ detail: 'test-hook native artifact cannot be reused' });
  const dest = join(output, target);
  yield* installArtifact(join(input, target), dest);
  yield* validateArtifact(dest, target, false);
});

const cacheArtifact = Effect.fn('native.cacheArtifact')(function*(input: string, cache: string, target: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(cache, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: '.publish-' });
  yield* copyArtifact(input, staging, target);
  const dest = join(cache, target);
  const valid = yield* validateArtifact(dest, target, false).pipe(Effect.map(existing => !existing.testHooks), Effect.catch(() => Effect.succeed(false)));
  if (valid) return;
  yield* fs.remove(dest, { recursive: true, force: true });
  yield* fs.rename(join(staging, target), dest);
}, Effect.scoped);

const reuseNative = Effect.fn('native.reuse')(function* (cache: string, output: string, target: string) {
  const local = yield* copyArtifact(cache, output, target).pipe(
    Effect.matchEffect({ onFailure: cause => reason('cache', reuseFailure(cause)).pipe(Effect.as(false)), onSuccess: () => Effect.succeed(true) }),
  );
  if (local) { yield* Console.error(`# Native cache hit: ${join(cache, target)}`); return true; }
  if (process.env.CONCORD_NATIVE_OFFLINE === '1') {
    yield* Console.error('# Native download skipped: CONCORD_NATIVE_OFFLINE=1; falling back to cargo');
    return false;
  }
  return yield* Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-download-' });
    const base = process.env.CONCORD_NATIVE_RELEASE_BASE_URL ?? 'https://github.com/CorrectRoadH/Concord/releases/download';
    const sourceDigest = yield* Effect.sync(digestSources);
    const url = `${base.replace(/\/$/u, '')}/native-${sourceDigest.slice(0, 16)}/concord-native-${target}.tar.gz`;
    const bytes = yield* Effect.gen(function*() {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      const response = yield* client.get(url);
      const body = yield* response.stream.pipe(Stream.runFoldEffect(() => ({ size: 0, chunks: [] as Uint8Array[] }), (state, chunk) => {
        const size = state.size + chunk.byteLength;
        if (size > 128 * 1024 * 1024) return Effect.fail(new NativeReuseFailed({ detail: 'native download exceeds 128 MiB' }));
        state.chunks.push(chunk);
        return Effect.succeed({ size, chunks: state.chunks });
      }));
      return Buffer.concat(body.chunks);
    }).pipe(Effect.timeout('30 seconds'), Effect.provide(FetchHttpClient.layer), Effect.mapError(reuseFailure));
    const archive = join(scratch, 'native.tar.gz');
    yield* fs.writeFile(archive, bytes);
    const names = (yield* commandOutput('tar', ['-tzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    if (!names.length || names.some(name => !name.startsWith(`${target}/`) || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.'))) return yield* new NativeReuseFailed({ detail: 'unsafe native archive paths' });
    const entries = (yield* commandOutput('tar', ['-tvzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    if (entries.some(entry => !/^[-d]/u.test(entry))) return yield* new NativeReuseFailed({ detail: 'native archive contains links or special files' });
    yield* commandOutput('tar', ['-xzf', archive, '-C', scratch, '--no-same-owner', '--no-same-permissions']);
    yield* copyArtifact(scratch, output, target);
    yield* cacheArtifact(scratch, cache, target);
    yield* Console.error(`# Native release hit: native-${sourceDigest.slice(0, 16)} / ${target}`);
    return true;
  })).pipe(Effect.catch(cause => reason('download', reuseFailure(cause)).pipe(Effect.as(false))));
});

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const args = yield* Effect.try({ try: () => parseArgs(process.argv.slice(2)), catch: buildFailure });
  const output = resolve(root, args.output);
  if (args.requirePortable && args.testHooks) return yield* new NativeBuildFailed({ detail: 'test hooks cannot be portable' });
  if (args.prebuilt) {
    const input = resolve(root, args.prebuilt);
    const targets = args.requirePortable ? HAWDB_TARGETS : (yield* fs.readDirectory(input)).filter(value => (HAWDB_TARGETS as readonly string[]).includes(value));
    if (targets.length === 0) return yield* new NativeBuildFailed({ detail: 'no native artifacts supplied' });
    const verified = yield* Effect.all(targets.map(target => validateArtifact(join(input, target), target, args.requirePortable)));
    if (args.requirePortable && verified.length !== HAWDB_TARGETS.length) return yield* new NativeBuildFailed({ detail: 'both release targets required' });
    for (const target of targets) yield* installArtifact(join(input, target), join(output, target));
    return;
  }
  const target = yield* Effect.sync(hawdbTarget);
  const cache = yield* Effect.sync(nativeCacheRoot);
  if (args.reuse && !args.testHooks && !args.requirePortable && (yield* reuseNative(cache, output, target))) return;
  if (target === 'darwin-arm64' && process.env.MACOSX_DEPLOYMENT_TARGET !== HAWDB_MACOS_DEPLOYMENT_TARGET) return yield* new NativeBuildFailed({ detail: `MACOSX_DEPLOYMENT_TARGET=${HAWDB_MACOS_DEPLOYMENT_TARGET} required` });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(ChildProcess.make('cargo', ['+1.97.1', 'build', '--release', '--locked', '--manifest-path', join(crate, 'Cargo.toml'), ...(args.testHooks ? ['--features', 'test-hooks'] : [])], { stdout: 'inherit', stderr: 'inherit' }));
  if (exitCode !== 0) return yield* new NativeBuildFailed({ detail: `cargo native build failed: ${exitCode}` });
  const library = join(process.env.CARGO_TARGET_DIR ?? join(crate, 'target'), 'release', target === 'darwin-arm64' ? 'libconcord_hawdb_native.dylib' : 'libconcord_hawdb_native.so');
  const dest = join(output, target);
  yield* fs.makeDirectory(dest, { recursive: true });
  const binary = join(dest, 'hawdb.node');
  const staging = yield* fs.makeTempDirectoryScoped({ directory: dest, prefix: '.native-build-' });
  yield* fs.copyFile(library, join(staging, 'hawdb.node'));
  yield* fs.rename(join(staging, 'hawdb.node'), binary);
  yield* fs.copyFile(join(crate, 'HAWDB-LICENSE.txt'), join(dest, 'HAWDB-LICENSE.txt'));
  yield* fs.copyFile(join(crate, 'UPSTREAM.txt'), join(dest, 'UPSTREAM.txt'));
  yield* dependencyNotices(dest);
  const artifact: NativeArtifact = {
    target, abi: HAWDB_ABI, revision: HAWDB_REVISION,
    sourceDigest: yield* Effect.sync(digestSources), cargoLockDigest: yield* shaFile(join(crate, 'Cargo.lock')),
    binarySha256: yield* shaFile(binary), noticesSha256: yield* shaFile(join(dest, 'THIRD-PARTY-NOTICES.txt')), portable: !args.testHooks && (yield* portableLinkage(binary, target)), testHooks: args.testHooks,
    ...(target === 'darwin-arm64' ? { deploymentTarget: HAWDB_MACOS_DEPLOYMENT_TARGET } : {}),
  };
  yield* fs.writeFileString(join(dest, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  yield* validateArtifact(dest, target, args.requirePortable);
  if (args.reuse && !args.testHooks) {
    yield* cacheArtifact(output, cache, target).pipe(Effect.catch(cause => Console.error(`# Native cache write failed: ${String(cause)}`)));
  }
}).pipe(Effect.scoped);
program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
