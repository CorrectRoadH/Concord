import { installationResources, decodeNativeArtifact, hawdbTarget } from '../src/base/installation/index.js';
import assert from 'node:assert/strict';
import { packageBin } from './package-location.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from './test-temporary.js';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';

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
export const replaceInstalledNativeBinary = (binary: string, bytes: Uint8Array): void => {
  const staging = mkdtempSync(join(dirname(binary), '.native-fixture-'));
  try {
    const next = join(staging, 'hawdb.node');
    writeFileSync(next, bytes);
    renameSync(next, binary);
  } finally { rmSync(staging, { recursive: true, force: true }); }
};

/** Exercise only the installed package, with no Rust compiler or database helper on PATH. */
export const verifyInstalledNative = (packageRoot: string) => Effect.try({
  try: () => {
    const installed = realpathSync(resolve(packageRoot));
    const cli = packageBin(installed);
    assert.ok(existsSync(cli), 'installed CLI is required');
    const scratch = mkdtempSync(join(tmpdir(), 'concord-native-install-'));
    try {
      const bin = join(scratch, 'bin');
      const rootPath = join(scratch, 'consumer');
      mkdirSync(bin); mkdirSync(rootPath);
      const root = realpathSync(rootPath);
      const git = (process.env.PATH ?? '').split(delimiter).map(path => join(path, 'git')).find(existsSync);
      assert.ok(git, 'Git is a public runtime dependency');
      symlinkSync(resolve(git), join(bin, 'git'));
      symlinkSync(process.execPath, join(bin, 'node'));
      const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin };
      for (const key of Object.keys(env)) if (key.startsWith('GIT_') || key === 'NODE_OPTIONS') delete env[key];
      env.GIT_TERMINAL_PROMPT = '0';
      env.GIT_CONFIG_NOSYSTEM = '1';
      env.GIT_CONFIG_GLOBAL = '/dev/null';
      for (const tool of ['cargo', 'rustc', 'hawdb']) {
        const result = spawnSync(tool, ['--version'], { env, encoding: 'utf8' });
        assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code, 'ENOENT', `${tool} must be absent`);
      }
      const run = (command: string, args: readonly string[]) => {
        const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
        assert.equal(result.status, 0, JSON.stringify({ args, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }));
        return result.stdout;
      };
      const call = <A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>): A =>
        Schema.decodeUnknownSync(Schema.fromJsonString(schema), { onExcessProperty: 'ignore' })(run(process.execPath, [cli, '--root', root, '--json', ...args]));
      const nativeFolder = join(installationResources(installed).native, hawdbTarget());
      const metadata = decodeNativeArtifact(JSON.parse(readFileSync(join(nativeFolder, 'artifact.json'), 'utf8')));
      const identity = Schema.decodeUnknownSync(Identity)({ engine: 'hawdb', ...metadata });
      run(join(bin, 'git'), ['init', '-q', root]);
      call(['init', '--docs-only'], Ack);
      call(['cache', 'clear'], Ack);
      const absentPreview = call(['cache', 'clear', '--dry-run'], CachePreview);
      assert.equal(absentPreview.existing, false);
      assert.deepEqual(absentPreview.remove, []);
      assert.equal(existsSync(absentPreview.path), false, 'preview must not create the cache');
      const cold = call(['test', 'list'], CacheResult);
      const warm = call(['test', 'list'], CacheResult);
      assert.equal(cold.cache.status, 'miss', 'a fallback parse does not prove HawDB installation');
      assert.equal(warm.cache.status, 'hit', 'installed HawDB must persist between CLI processes');
      assert.equal(dirname(warm.cache.path), join(root, '.git/concord'));
      assert.equal(warm.cache.path, join(root, '.git/concord/cache.hawdb'));
      assert.equal(call(['cache', 'status'], CacheStatus).status, 'ready');
      assert.equal(existsSync(join(root, '.git/concord/cache.sqlite')), false);

      const body = join(scratch, 'memory-input.md');
      writeFileSync(body, '# Cached knowledge\n\nold-native-projection-token\n');
      call(['new', 'memory', 'native-recall', '--title', 'Cached knowledge', '--type', 'note', '--body', body], Ack);
      assert.equal(call(['memory', 'recall', 'old-native-projection-token'], Recall).documents.length, 1);
      const before = call(['show', 'native-recall'], Memory).document.digest;
      const memoryPath = join(root, 'memory/native-recall.md');
      writeFileSync(memoryPath, readFileSync(memoryPath, 'utf8').replace('old-native-projection-token', 'current-native-projection-token'));
      assert.equal(call(['memory', 'recall', 'old-native-projection-token'], Recall).documents.length, 0);
      const current = call(['memory', 'recall', 'current-native-projection-token'], Recall);
      assert.equal(current.documents.length, 1);
      const currentDigest = call(['show', 'native-recall'], Memory).document.digest;
      assert.notEqual(currentDigest, before);
      call(['cache', 'clear'], Ack);
      assert.equal(call(['cache', 'status'], CacheStatus).status, 'empty');
      assert.equal(call(['memory', 'recall', 'current-native-projection-token'], Recall).documents.length, 1);
      assert.equal(call(['show', 'native-recall'], Memory).document.digest, currentDigest);
      call(['cache', 'clear'], Ack);
      assert.equal(call(['test', 'list'], CacheResult).cache.status, 'miss');
      assert.equal(call(['test', 'list'], CacheResult).cache.status, 'hit');
      const cachePath = warm.cache.path;
      const beforePreview = readdirSync(cachePath).sort();
      const lockInode = statSync(join(cachePath, 'owner.hawdb.lock')).ino;
      const preview = call(['cache', 'clear', '--dry-run'], CachePreview);
      assert.equal(preview.native.status, 'ready');
      assert.deepEqual(preview.remove, beforePreview.filter(name => name !== 'owner.hawdb.lock').map(name => join(cachePath, name)));
      assert.deepEqual(preview.preserve, [cachePath, join(cachePath, 'owner.hawdb.lock'), `${cachePath}.concord.lock`]);
      assert.equal(call(['test', 'list'], CacheResult).cache.status, 'hit', 'preview must preserve cached projections');
      assert.equal(statSync(join(cachePath, 'owner.hawdb.lock')).ino, lockInode);

      const nativeBinary = join(nativeFolder, 'hawdb.node');
      const binaryBytes = readFileSync(nativeBinary);
      try {
        // Mutate this isolated installed consumer, never the packed candidate.
        replaceInstalledNativeBinary(nativeBinary, Buffer.concat([binaryBytes, Buffer.from('digest mismatch')]));
        const unavailable = call(['cache', 'status'], CacheStatus);
        assert.equal(unavailable.status, 'unavailable');
        assert.match(unavailable.detail!, /native binary digest differs:.*expected .*actual .*Reinstall/u);
        assert.ok(unavailable.detail!.includes(nativeBinary));
        assert.ok(unavailable.detail!.includes(join(nativeFolder, 'artifact.json')));
        const fallback = call(['test', 'list'], CacheResult);
        assert.equal(fallback.cache.status, 'unavailable');
        assert.equal(fallback.cache.detail, unavailable.detail);
        const blockedPreview = call(['cache', 'clear', '--dry-run'], CachePreview);
        assert.equal(blockedPreview.native.status, 'unavailable');
        assert.equal(blockedPreview.native.detail, unavailable.detail);
        const failedClear = spawnSync(process.execPath, [cli, '--root', root, '--json', 'cache', 'clear'], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
        assert.notEqual(failedClear.status, 0);
        assert.deepEqual(readdirSync(cachePath).sort(), beforePreview);
        assert.equal(statSync(join(cachePath, 'owner.hawdb.lock')).ino, lockInode);
        assert.equal(call(['show', 'native-recall'], Memory).document.digest, currentDigest);
      } finally { replaceInstalledNativeBinary(nativeBinary, binaryBytes); }
      assert.equal(call(['test', 'list'], CacheResult).cache.status, 'hit');
      return { ...identity, compilerOnPath: false, helperOnPath: false, persistentHit: true, currentRecall: true, rebuilt: true };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  },
  catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
});

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageRoot = process.argv[2];
  (packageRoot === undefined ? Effect.fail(new Error('Usage: verify-installed-native.ts <installed-package-directory>')) : verifyInstalledNative(packageRoot))
    .pipe(Effect.tap(result => Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`))), NodeRuntime.runMain);
}
