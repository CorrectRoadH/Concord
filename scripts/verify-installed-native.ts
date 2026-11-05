import { installationResources, decodeNativeArtifact, hawdbTarget } from '../src/base/installation/index.js';
import assert from 'node:assert/strict';
import { packageBin } from './package-location.js';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Cause, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';

class NativeVerificationFailed extends Schema.TaggedError<NativeVerificationFailed>()('NativeVerificationFailed', { message: Schema.String }) {}

const Ack = Schema.Struct({});
const CacheStatus = Schema.Struct({ status: Schema.String, path: Schema.String, detail: Schema.optional(Schema.String) });
const CacheResult = Schema.Struct({ cache: CacheStatus });
const CachePreview = Schema.Struct({
  operation: Schema.Literal('cache-clear'), dryRun: Schema.Literal(true), engine: Schema.Literal('hawdb'),
  path: Schema.String, existing: Schema.Boolean, remove: Schema.Array(Schema.String), preserve: Schema.Array(Schema.String),
  native: Schema.Struct({ status: Schema.String, detail: Schema.optional(Schema.String) }),
  ownership: Schema.Literal('checked-on-execution'),
});
const Memory = Schema.Struct({ document: Schema.Struct({ digest: Schema.String }) });
const Recall = Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, body: Schema.String })) });
const Identity = Schema.Struct({ engine: Schema.Literal('hawdb'), revision: Schema.String, abi: Schema.String, target: Schema.String });

/** Preserve the inode of any native image already mapped by a fixture process. */
export const replaceInstalledNativeBinary = Effect.fn('native.replaceInstalledBinary')(function*(binary: string, bytes: Uint8Array) {
  const fs = yield* FileSystem.FileSystem;
  const staging = yield* fs.makeTempDirectoryScoped({ directory: dirname(binary), prefix: '.native-fixture-' });
  const next = join(staging, 'hawdb.node');
  yield* fs.writeFile(next, bytes);
  yield* fs.rename(next, binary);
}, Effect.scoped);

/** Exercise only the installed package, with no Rust compiler or database helper on PATH. */
export const verifyInstalledNative = Effect.fn('native.verifyInstalled')(function*(packageRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const installed = yield* fs.realPath(resolve(packageRoot));
  const cli = yield* packageBin(installed);
  assert.ok(yield* fs.exists(cli), 'installed CLI is required');
  const scratch = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-native-install-' });
  const bin = join(scratch, 'bin');
  const rootPath = join(scratch, 'consumer');
  yield* fs.makeDirectory(bin); yield* fs.makeDirectory(rootPath);
  const root = yield* fs.realPath(rootPath);
  let git: string | undefined;
  for (const path of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(path, 'git');
    if (yield* fs.exists(candidate)) { git = candidate; break; }
  }
  assert.ok(git, 'Git is a public runtime dependency');
  yield* fs.symlink(resolve(git), join(bin, 'git'));
  yield* fs.symlink(process.execPath, join(bin, 'node'));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'NODE_OPTIONS') delete env[key];
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  for (const tool of ['cargo', 'rustc', 'hawdb']) {
    const absent = yield* spawner.exitCode(ChildProcess.make(tool, ['--version'], { env })).pipe(
      Effect.match({ onFailure: error => error.reason._tag === 'NotFound', onSuccess: () => false }),
    );
    assert.equal(absent, true, `${tool} must be absent`);
  }
  const run = Effect.fn('native.verifyCommand')(function*(command: string, args: readonly string[], expected: number | null = 0) {
    const child = yield* spawner.spawn(ChildProcess.make(command, args, { cwd: root, env }));
    const collect = (stream: typeof child.stdout) => Effect.suspend(() => {
      let bytes = 0;
      return stream.pipe(Stream.mapEffect(chunk => {
        bytes += chunk.byteLength;
        return bytes > 1024 * 1024 ? Effect.fail(new NativeVerificationFailed({ message: 'Installed command output exceeds 1 MiB' })) : Effect.succeed(chunk);
      }), Stream.decodeText(), Stream.mkString);
    });
    const [status, stdout, stderr] = yield* Effect.all([child.exitCode, collect(child.stdout), collect(child.stderr)], { concurrency: 'unbounded' });
    if (expected !== null) assert.equal(status, expected, JSON.stringify({ args, stdout, stderr }));
    return { status, stdout, stderr };
  }, Effect.scoped, Effect.timeout('30 seconds'));
  const call = Effect.fn('native.verifyCall')(function*<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>) {
    const result = yield* run(process.execPath, [cli, '--root', root, '--json', ...args]);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { onExcessProperty: 'ignore' })(result.stdout);
  });
  const nativeFolder = join(installationResources(installed).native, hawdbTarget());
  const metadataText = yield* fs.readFileString(join(nativeFolder, 'artifact.json'));
  const metadata = yield* Effect.try({ try: () => decodeNativeArtifact(JSON.parse(metadataText)), catch: cause => new NativeVerificationFailed({ message: String(cause) }) });
  const identity = Schema.decodeUnknownSync(Identity)({ engine: 'hawdb', ...metadata });
  yield* run(join(bin, 'git'), ['init', '-q', root]);
  yield* call(['init', '--docs-only'], Ack);
  yield* call(['cache', 'clear'], Ack);
  const absentPreview = yield* call(['cache', 'clear', '--dry-run'], CachePreview);
  assert.equal(absentPreview.existing, false);
  assert.deepEqual(absentPreview.remove, []);
  assert.equal(yield* fs.exists(absentPreview.path), false, 'preview must not create the cache');
  const cold = yield* call(['cache', 'rebuild'], CacheResult);
  const warm = yield* call(['test', 'list'], CacheResult);
  assert.equal(cold.cache.status, 'miss', 'a fallback parse does not prove HawDB installation');
  assert.equal(warm.cache.status, 'hit', 'installed HawDB must persist between CLI processes');
  assert.equal(dirname(warm.cache.path), join(root, '.git/concord'));
  assert.equal(warm.cache.path, join(root, '.git/concord/cache.hawdb'));
  assert.equal((yield* call(['cache', 'status'], CacheStatus)).status, 'ready');
  assert.equal(yield* fs.exists(join(root, '.git/concord/cache.sqlite')), false);

  const body = join(scratch, 'memory-input.md');
  yield* fs.writeFileString(body, '# Cached knowledge\n\nold-native-projection-token\n');
  yield* call(['new', 'memory', 'native-recall', '--title', 'Cached knowledge', '--type', 'note', '--body', body], Ack);
  assert.equal((yield* call(['memory', 'recall', 'old-native-projection-token'], Recall)).documents.length, 1);
  const before = (yield* call(['show', 'native-recall'], Memory)).document.digest;
  const memoryPath = join(root, 'memory/native-recall.md');
  yield* fs.writeFileString(memoryPath, (yield* fs.readFileString(memoryPath)).replace('old-native-projection-token', 'current-native-projection-token'));
  assert.equal((yield* call(['memory', 'recall', 'old-native-projection-token'], Recall)).documents.length, 0);
  const current = yield* call(['memory', 'recall', 'current-native-projection-token'], Recall);
  assert.equal(current.documents.length, 1);
  const currentDigest = (yield* call(['show', 'native-recall'], Memory)).document.digest;
  assert.notEqual(currentDigest, before);
  yield* call(['cache', 'clear'], Ack);
  assert.equal((yield* call(['cache', 'status'], CacheStatus)).status, 'empty');
  assert.equal((yield* call(['memory', 'recall', 'current-native-projection-token'], Recall)).documents.length, 1);
  assert.equal((yield* call(['show', 'native-recall'], Memory)).document.digest, currentDigest);
  yield* call(['cache', 'clear'], Ack);
  assert.equal((yield* call(['cache', 'rebuild'], CacheResult)).cache.status, 'miss');
  assert.equal((yield* call(['test', 'list'], CacheResult)).cache.status, 'hit');
  const cachePath = warm.cache.path;
  const beforePreview = (yield* fs.readDirectory(cachePath)).sort();
  const lockInode = (yield* fs.stat(join(cachePath, 'owner.hawdb.lock'))).ino;
  const preview = yield* call(['cache', 'clear', '--dry-run'], CachePreview);
  assert.equal(preview.native.status, 'ready');
  assert.deepEqual(preview.remove, beforePreview.filter(name => name !== 'owner.hawdb.lock').map(name => join(cachePath, name)));
  assert.deepEqual(preview.preserve, [cachePath, join(cachePath, 'owner.hawdb.lock'), `${cachePath}.concord.lock`]);
  assert.equal((yield* call(['test', 'list'], CacheResult)).cache.status, 'hit', 'preview must preserve cached projections');
  assert.deepEqual((yield* fs.stat(join(cachePath, 'owner.hawdb.lock'))).ino, lockInode);

  const nativeBinary = join(nativeFolder, 'hawdb.node');
  const binaryBytes = yield* fs.readFile(nativeBinary);
  yield* Effect.gen(function*() {
    // Mutate this isolated installed consumer, never the packed candidate.
    yield* replaceInstalledNativeBinary(nativeBinary, Buffer.concat([binaryBytes, Buffer.from('digest mismatch')]));
    const unavailable = yield* call(['cache', 'status'], CacheStatus);
    assert.equal(unavailable.status, 'unavailable');
    assert.match(unavailable.detail!, /native binary digest differs:.*expected .*actual .*Reinstall/u);
    assert.ok(unavailable.detail!.includes(nativeBinary));
    assert.ok(unavailable.detail!.includes(join(nativeFolder, 'artifact.json')));
    const fallback = yield* call(['test', 'list'], CacheResult);
    assert.equal(fallback.cache.status, 'unavailable');
    assert.equal(fallback.cache.detail, unavailable.detail);
    const blockedPreview = yield* call(['cache', 'clear', '--dry-run'], CachePreview);
    assert.equal(blockedPreview.native.status, 'unavailable');
    assert.equal(blockedPreview.native.detail, unavailable.detail);
    const failedClear = yield* run(process.execPath, [cli, '--root', root, '--json', 'cache', 'clear'], null);
    assert.notEqual(failedClear.status, 0);
    assert.deepEqual((yield* fs.readDirectory(cachePath)).sort(), beforePreview);
    assert.deepEqual((yield* fs.stat(join(cachePath, 'owner.hawdb.lock'))).ino, lockInode);
    assert.equal((yield* call(['show', 'native-recall'], Memory)).document.digest, currentDigest);
  }).pipe(Effect.ensuring(replaceInstalledNativeBinary(nativeBinary, binaryBytes).pipe(Effect.orDie)));
  assert.equal((yield* call(['test', 'list'], CacheResult)).cache.status, 'hit');
  return { ...identity, compilerOnPath: false, helperOnPath: false, persistentHit: true, currentRecall: true, rebuilt: true };
}, Effect.scoped, Effect.catchCause(cause => Effect.fail(new NativeVerificationFailed({ message: Cause.pretty(cause) }))));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = process.argv[2];
  (packageRoot === undefined ? Effect.fail(new NativeVerificationFailed({ message: 'Usage: verify-installed-native.ts <installed-package-directory>' })) : verifyInstalledNative(packageRoot))
    .pipe(Effect.tap(result => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))), Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
