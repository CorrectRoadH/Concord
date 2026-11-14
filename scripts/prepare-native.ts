import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { Console, Effect, FileSystem, Schema, Stream } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { HAWDB_TARGETS, hawdbLibraryName, hawdbTarget, type HawdbTarget } from "../src/base/installation/hawdb-native-contract.ts";

import { nativeCacheRoot, verifyNativeArtifactDirectory } from '../src/base/installation/native-artifact.ts';
import { readNativeRelease, nativeReleaseAsset } from '../src/base/installation/native-release.ts';

import { makeRuntimeEnvironment } from '../src/base/environment/index.ts';

const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
const root = resolve(import.meta.dirname, '..');
const release = readNativeRelease();
const hash = (data: Uint8Array | string): string => createHash('sha256').update(data).digest('hex');
class NativePreparationFailed extends Schema.TaggedError<NativePreparationFailed>()('NativePreparationFailed', { detail: Schema.String }) {
  override get message(): string { return this.detail; }
}
const preparationFailure = (cause: unknown) => new NativePreparationFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
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
const ArgsSchema = Schema.Struct({ output: Schema.optional(Schema.String), prebuilt: Schema.optional(Schema.String), requirePortable: Schema.Boolean, target: Schema.optional(Schema.Literals(HAWDB_TARGETS)) });
function parseArgs(argv: readonly string[]): Schema.Schema.Type<typeof ArgsSchema> {
  const result: { output?: string; prebuilt?: string; requirePortable: boolean; target?: HawdbTarget } = { requirePortable: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--output' && argv[i + 1]) result.output = argv[++i]!;
    else if (value === '--prebuilt' && argv[i + 1]) result.prebuilt = argv[++i]!;
    else if (value === '--target' && argv[i + 1]) result.target = Schema.decodeUnknownSync(Schema.Literals(HAWDB_TARGETS))(argv[++i]);
    else if (value === '--require-portable') result.requirePortable = true;
    else throw new Error(`unknown or incomplete native preparation argument: ${value}`);
  }
  return Schema.decodeUnknownSync(ArgsSchema, { onExcessProperty: 'error' })(result);
}
const validateArtifact = Effect.fn('native.validateArtifact')(function*(folder: string, target: HawdbTarget, _requirePortable: boolean) {
  return yield* Effect.try({ try: () => verifyNativeArtifactDirectory(folder, target), catch: preparationFailure });
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
  // Replace the private directory by rename; never follow a corrupt destination
  // directory link or truncate an image another process may have mapped.
  yield* fs.remove(destination, { recursive: true, force: true });
  yield* fs.rename(staged, destination);
}, Effect.scoped);

const copyArtifact = Effect.fn('native.copyArtifact')(function*(input: string, output: string, target: HawdbTarget) {
  yield* validateArtifact(join(input, target), target, false);
  const dest = join(output, target);
  yield* installArtifact(join(input, target), dest);
  yield* validateArtifact(dest, target, false);
});

const cacheArtifact = Effect.fn('native.cacheArtifact')(function*(input: string, cache: string, target: HawdbTarget) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(cache, { recursive: true });
  const staging = yield* fs.makeTempDirectoryScoped({ directory: cache, prefix: '.publish-' });
  yield* copyArtifact(input, staging, target);
  const dest = join(cache, target);
  const valid = yield* validateArtifact(dest, target, false).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
  if (valid) return;
  yield* fs.remove(dest, { recursive: true, force: true });
  yield* fs.rename(join(staging, target), dest);
}, Effect.scoped);

const reuseNative = Effect.fn('native.reuse')(function* (cache: string, output: string, target: HawdbTarget) {
  const local = yield* copyArtifact(cache, output, target).pipe(
    Effect.matchEffect({ onFailure: cause => reason('cache', reuseFailure(cause)).pipe(Effect.as(false)), onSuccess: () => Effect.succeed(true) }),
  );
  if (local) { yield* Console.error(`# Native cache hit: ${join(cache, target)}`); return true; }
  if (process.env.CONCORD_NATIVE_OFFLINE === '1') {
    return yield* new NativePreparationFailed({ detail: `Native ${release.tag} cache missing or invalid; CONCORD_NATIVE_OFFLINE=1 forbids downloading` });
  }
  return yield* Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-download-' });
    const base = process.env.CONCORD_NATIVE_RELEASE_BASE_URL ?? 'https://github.com/nowledge-co/hawdb/releases/download';
    const expected = nativeReleaseAsset(release, target);
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
    const prefix = expected.name.replace(/\.tar\.gz$/u, '');
    const names = (yield* commandOutput('tar', ['-tzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    const members = [prefix + '/', ...['LICENSE', 'include/', 'include/hawdb_ffi.h', 'lib/', 'lib/libhawdb_ffi.a', hawdbLibraryName(target), 'manifest.json'].map(name => `${prefix}/${name}`)].sort();
    if (JSON.stringify([...names].sort()) !== JSON.stringify(members)) return yield* new NativeReuseFailed({ detail: 'unsafe, duplicate or unknown native archive paths' });
    const entries = (yield* commandOutput('tar', ['-tvzf', archive], 4 * 1024 * 1024)).trim().split('\n');
    if (entries.length !== members.length || entries.some(entry => !/^[-d]/u.test(entry))) return yield* new NativeReuseFailed({ detail: 'native archive contains links or special files' });
    yield* commandOutput('tar', ['-xzf', archive, '-C', scratch, '--no-same-owner', '--no-same-permissions']);
    const extracted = join(scratch, prefix);
    yield* fs.writeFileString(join(extracted, 'artifact.json'), JSON.stringify({ format: 'concord.native-artifact/v2', target, upstreamManifestSha256: expected.manifestSha256, binarySha256: expected.binarySha256 }) + '\n');
    yield* fs.rename(extracted, join(scratch, target));
    yield* copyArtifact(scratch, output, target);
    yield* cacheArtifact(scratch, cache, target);
    yield* Console.error(`# Native release hit: ${release.tag} / ${target}`);
    return true;
  })).pipe(Effect.mapError(cause => new NativePreparationFailed({ detail: `Cannot prepare ${release.tag} for ${target}: ${reuseFailure(cause).detail}` })));
});

const program = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const args = yield* Effect.try({ try: () => parseArgs(process.argv.slice(2)), catch: preparationFailure });
  const cache = nativeCacheRoot(runtime);
  const output = args.output ? resolve(root, args.output) : cache;
  if (args.prebuilt) {
    const input = resolve(root, args.prebuilt);
    const targets = (yield* fs.readDirectory(input)).filter((value): value is HawdbTarget => (HAWDB_TARGETS as readonly string[]).includes(value) && (args.target === undefined || value === args.target));
    if (targets.length === 0) return yield* new NativePreparationFailed({ detail: 'no native artifacts supplied' });
    for (const target of targets) yield* validateArtifact(join(input, target), target, args.requirePortable);
    for (const target of targets) yield* installArtifact(join(input, target), join(output, target));
  } else {
    const target = args.target ?? (yield* Effect.sync(hawdbTarget));
    yield* reuseNative(cache, output, target);
    yield* validateArtifact(join(output, target), target, args.requirePortable);
  }
}).pipe(Effect.scoped);
program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
