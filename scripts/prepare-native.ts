import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Console, Effect, FileSystem, Schema, Stream, type PlatformError } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_TARGETS, HAWDB_MACOS_DEPLOYMENT_TARGET, decodeNativeArtifact, hawdbTarget, readNativeRelease, nativeReleaseAsset, type HawdbTarget } from "../src/base/installation/index.ts";

import { nativeCacheRoot } from "../src/base/installation/index.ts";

import { makeRuntimeEnvironment } from '../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const root = resolve(import.meta.dirname, '..');
const release = readNativeRelease();
const hash = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
class NativePreparationFailed extends Schema.TaggedError<NativePreparationFailed>()('NativePreparationFailed', { detail: Schema.String }) {
  override get message(): string { return this.detail; }
}
const preparationFailure = (cause: unknown) => new NativePreparationFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
// FileSystem.stat follows symlinks; artifact and license boundaries must not.
const inspectEntry = (path: string) => Effect.tryPromise({ try: () => lstat(path), catch: preparationFailure });
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
    return bytes > limit ? Effect.fail(new NativePreparationFailed({ detail: `${command} output exceeds ${limit} bytes` })) : Effect.succeed(chunk);
  }), Stream.decodeText(), Stream.mkString);
  const [text, code] = yield* Effect.all([stdout, child.exitCode], { concurrency: 'unbounded' });
  if (code !== 0) return yield* new NativePreparationFailed({ detail: `${command} exited ${code}` });
  return text;
}, Effect.scoped);
const LicenseDigests = Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String }));
const licenseMarker = 'Concord license file digests:';
const licenseDigests = Effect.fn('native.licenseDigests')(function*(folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = ['HAWDB-LICENSE.txt', 'UPSTREAM.txt'];
  const visit = Effect.fn('native.visitLicenseDirectory')(function*(directory: string): Effect.fn.Return<void, NativePreparationFailed | PlatformError.PlatformError, FileSystem.FileSystem> {
    for (const name of yield* fs.readDirectory(join(folder, directory))) {
      const path = `${directory}/${name}`;
      const entry = yield* inspectEntry(join(folder, path));
      if (entry.isDirectory()) yield* visit(path);
      else if (entry.isFile()) files.push(path);
      else return yield* new NativePreparationFailed({ detail: `native license must be a regular file: ${path}` });
    }
  });
  if (!(yield* inspectEntry(join(folder, 'licenses'))).isDirectory()) return yield* new NativePreparationFailed({ detail: 'native licenses must be a regular directory' });
  yield* visit('licenses');
  return yield* Effect.all(files.sort().map(path => shaFile(join(folder, path)).pipe(Effect.map(sha256 => ({ path, sha256 })))));
});
const ArgsSchema = Schema.Struct({ output: Schema.optional(Schema.String), prebuilt: Schema.optional(Schema.String), requirePortable: Schema.Boolean, testHooks: Schema.Boolean, allModes: Schema.Boolean, target: Schema.optional(Schema.Literals(HAWDB_TARGETS)) });
function parseArgs(argv: readonly string[]): Schema.Schema.Type<typeof ArgsSchema> {
  const result: { output?: string; prebuilt?: string; requirePortable: boolean; testHooks: boolean; allModes: boolean; target?: HawdbTarget } = { requirePortable: false, testHooks: false, allModes: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--output' && argv[i + 1]) result.output = argv[++i]!;
    else if (value === '--prebuilt' && argv[i + 1]) result.prebuilt = argv[++i]!;
    else if (value === '--target' && argv[i + 1]) result.target = Schema.decodeUnknownSync(Schema.Literals(HAWDB_TARGETS))(argv[++i]);
    else if (value === '--require-portable') result.requirePortable = true;
    else if (value === '--test-hooks') result.testHooks = true;
    else if (value === '--all-modes') result.allModes = true;
    else throw new Error(`unknown or incomplete native preparation argument: ${value}`);
  }
  if (result.allModes && (result.testHooks || result.prebuilt || result.requirePortable)) throw new Error('--all-modes cannot combine with --test-hooks, --prebuilt or --require-portable');
  return Schema.decodeUnknownSync(ArgsSchema, { onExcessProperty: 'error' })(result);
}
const validateArtifact = Effect.fn('native.validateArtifact')(function*(folder: string, target: HawdbTarget, requirePortable: boolean, testHooks: boolean) {
  const fs = yield* FileSystem.FileSystem;
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt', 'HAWDB-LICENSE.txt', 'UPSTREAM.txt']) {
    if (!(yield* inspectEntry(join(folder, name))).isFile()) return yield* new NativePreparationFailed({ detail: `native artifact must be a regular file: ${name}` });
  }
  const metadata = yield* fs.readFileString(join(folder, 'artifact.json'));
  const artifact = yield* Effect.try({ try: () => decodeNativeArtifact(JSON.parse(metadata)), catch: preparationFailure });
  if (artifact.target !== target || artifact.abi !== HAWDB_ABI || artifact.revision !== HAWDB_REVISION) return yield* new NativePreparationFailed({ detail: `native identity mismatch: ${folder}` });
  if (artifact.sourceDigest !== release.sourceDigest || artifact.cargoLockDigest !== release.cargoLockDigest) return yield* new NativePreparationFailed({ detail: `native source/lock mismatch: ${folder}` });
  const expected = nativeReleaseAsset(release, target, testHooks);
  if (artifact.testHooks !== testHooks || artifact.binarySha256 !== expected.binarySha256 || artifact.noticesSha256 !== expected.noticesSha256) return yield* new NativePreparationFailed({ detail: `native release/mode mismatch: ${folder}` });
  if (artifact.binarySha256 !== (yield* shaFile(join(folder, 'hawdb.node')))) return yield* new NativePreparationFailed({ detail: `native binary digest mismatch: ${folder}` });
  if (artifact.noticesSha256 !== (yield* shaFile(join(folder, 'THIRD-PARTY-NOTICES.txt')))) return yield* new NativePreparationFailed({ detail: `native dependency notices mismatch: ${folder}` });
  const noticeLines = (yield* fs.readFileString(join(folder, 'THIRD-PARTY-NOTICES.txt'))).trimEnd().split('\n');
  if (noticeLines.at(-2) !== licenseMarker) return yield* new NativePreparationFailed({ detail: `native license digests missing: ${folder}` });
  const expectedLicenses = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LicenseDigests), { onExcessProperty: 'error' })(noticeLines.at(-1));
  if (JSON.stringify(expectedLicenses) !== JSON.stringify(yield* licenseDigests(folder))) return yield* new NativePreparationFailed({ detail: `native license digest mismatch: ${folder}` });
  if (target === 'darwin-arm64' && artifact.deploymentTarget !== HAWDB_MACOS_DEPLOYMENT_TARGET) return yield* new NativePreparationFailed({ detail: `native deployment target mismatch: ${folder}` });
  if (requirePortable && artifact.testHooks) return yield* new NativePreparationFailed({ detail: `test-hook native artifact cannot ship: ${folder}` });
  if (requirePortable && !artifact.portable) return yield* new NativePreparationFailed({ detail: `native artifact is not portable: ${folder}` });
  return artifact;
});
class NativeReuseFailed extends Schema.TaggedError<NativeReuseFailed>()('NativeReuseFailed', { detail: Schema.String }) {}
const reuseFailure = (cause: unknown) => new NativeReuseFailed({ detail: cause instanceof NativePreparationFailed || cause instanceof NativeReuseFailed ? cause.detail : cause instanceof Error ? cause.message : String(cause) });
const reason = (source: string, cause: unknown) => {
  const detail = cause instanceof NativeReuseFailed ? cause.detail : String(cause);
  return Console.error(`# Native ${source}: ${detail.replace(/\s+/gu, ' ')}; trying fixed release`);
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

const copyArtifact = Effect.fn('native.copyArtifact')(function*(input: string, output: string, target: HawdbTarget, testHooks: boolean) {
  yield* validateArtifact(join(input, target), target, false, testHooks);
  const dest = join(output, target);
  yield* installArtifact(join(input, target), dest);
  yield* validateArtifact(dest, target, false, testHooks);
});

const cacheArtifact = Effect.fn('native.cacheArtifact')(function*(input: string, cache: string, target: HawdbTarget, testHooks: boolean) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(cache, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: '.publish-' });
  yield* copyArtifact(input, staging, target, testHooks);
  const dest = join(cache, target);
  const valid = yield* validateArtifact(dest, target, false, testHooks).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
  if (valid) return;
  yield* fs.remove(dest, { recursive: true, force: true });
  yield* fs.rename(join(staging, target), dest);
}, Effect.scoped);

const reuseNative = Effect.fn('native.reuse')(function* (cache: string, output: string, target: HawdbTarget, testHooks: boolean) {
  const local = yield* copyArtifact(cache, output, target, testHooks).pipe(
    Effect.matchEffect({ onFailure: cause => reason('cache', reuseFailure(cause)).pipe(Effect.as(false)), onSuccess: () => Effect.succeed(true) }),
  );
  if (local) { yield* Console.error(`# Native cache hit: ${join(cache, target)}`); return true; }
  if (process.env.CONCORD_NATIVE_OFFLINE === '1') {
    return yield* new NativePreparationFailed({ detail: `Native ${release.tag} cache missing or invalid; CONCORD_NATIVE_OFFLINE=1 forbids downloading` });
  }
  return yield* Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-download-' });
    const base = process.env.CONCORD_NATIVE_RELEASE_BASE_URL ?? 'https://github.com/CorrectRoadH/hawdb/releases/download';
    const expected = nativeReleaseAsset(release, target, testHooks);
    const url = `${base.replace(/\/$/u, '')}/${release.tag}/${expected.name}`;
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
    if (hash(bytes) !== expected.archiveSha256) return yield* new NativePreparationFailed({ detail: `native archive checksum mismatch: ${url}` });
    const archive = join(scratch, 'native.tar.gz');
    yield* fs.writeFile(archive, bytes);
    const names = (yield* commandOutput('tar', ['-tzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    if (!names.length || names.some(name => !name.startsWith(`${target}/`) || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.'))) return yield* new NativeReuseFailed({ detail: 'unsafe native archive paths' });
    const entries = (yield* commandOutput('tar', ['-tvzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    if (entries.some(entry => !/^[-d]/u.test(entry))) return yield* new NativeReuseFailed({ detail: 'native archive contains links or special files' });
    yield* commandOutput('tar', ['-xzf', archive, '-C', scratch, '--no-same-owner', '--no-same-permissions']);
    yield* copyArtifact(scratch, output, target, testHooks);
    yield* cacheArtifact(scratch, cache, target, testHooks);
    yield* Console.error(`# Native release hit: ${release.tag} / ${target} / ${testHooks ? 'test-hooks' : 'production'}`);
    return true;
  })).pipe(Effect.mapError(cause => new NativePreparationFailed({ detail: `Cannot prepare ${release.tag} for ${target}: ${reuseFailure(cause).detail}` })));
});

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const args = yield* Effect.try({ try: () => parseArgs(process.argv.slice(2)), catch: preparationFailure });
  if (args.requirePortable && args.testHooks) return yield* new NativePreparationFailed({ detail: 'test hooks cannot ship' });
  const modes = args.allModes ? [false, true] : [args.testHooks];
  for (const testHooks of modes) {
    const cache = nativeCacheRoot(runtime, testHooks);
    const output = args.output ? resolve(root, args.output, ...(args.allModes && testHooks ? ['test-hooks'] : [])) : cache;
    if (args.prebuilt) {
      const input = resolve(root, args.prebuilt);
      const targets = (yield* fs.readDirectory(input)).filter((value): value is HawdbTarget => (HAWDB_TARGETS as readonly string[]).includes(value));
      if (targets.length === 0) return yield* new NativePreparationFailed({ detail: 'no native artifacts supplied' });
      yield* Effect.all(targets.map(target => validateArtifact(join(input, target), target, args.requirePortable, testHooks)));
      for (const target of targets) yield* installArtifact(join(input, target), join(output, target));
    } else {
      const target = args.target ?? (yield* Effect.sync(hawdbTarget));
      yield* reuseNative(cache, output, target, testHooks);
      yield* validateArtifact(join(output, target), target, args.requirePortable, testHooks);
    }
  }
}).pipe(Effect.scoped);
program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
