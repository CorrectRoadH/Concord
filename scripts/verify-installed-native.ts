import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';

const Ack = Schema.Struct({});
const CacheResult = Schema.Struct({ cache: Schema.Struct({ status: Schema.String, path: Schema.String }) });
const CacheStatus = Schema.Struct({ status: Schema.String, path: Schema.String });
const Memory = Schema.Struct({ document: Schema.Struct({ digest: Schema.String }) });
const Recall = Schema.Struct({ documents: Schema.Array(Schema.Struct({ path: Schema.String, body: Schema.String })) });
const Identity = Schema.Struct({ engine: Schema.Literal('hawdb'), revision: Schema.String, abi: Schema.String, target: Schema.String });

/** Exercise only the installed package, with no Rust compiler or database helper on PATH. */
export const verifyInstalledNative = (packageRoot: string) => Effect.try({
  try: () => {
    const installed = resolve(packageRoot);
    const cli = join(installed, 'dist/entry.js');
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
      // Explicit JavaScript-consumer fixture: this imports the installed native loader, never source TS.
      const identity = Schema.decodeUnknownSync(Schema.fromJsonString(Identity))(
        run(process.execPath, ['--input-type=module', '-e', 'const {hawdbIdentity}=await import(process.argv[1]);console.log(JSON.stringify(hawdbIdentity()));', pathToFileURL(join(installed, 'dist/hawdb-native.js')).href]),
      );
      run(join(bin, 'git'), ['init', '-q', root]);
      call(['init', '--docs-only'], Ack);
      call(['cache', 'clear'], Ack);
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
      call(['memory', 'add', 'native-recall', '--title', 'Cached knowledge', '--kind', 'note', '--body', body], Ack);
      assert.equal(call(['memory', 'recall', 'old-native-projection-token'], Recall).documents.length, 1);
      const before = call(['memory', 'show', 'native-recall'], Memory).document.digest;
      writeFileSync(body, '# Cached knowledge\n\ncurrent-native-projection-token\n');
      call(['memory', 'edit', 'native-recall', '--body', body, '--expected-digest', before], Ack);
      assert.equal(call(['memory', 'recall', 'old-native-projection-token'], Recall).documents.length, 0);
      const current = call(['memory', 'recall', 'current-native-projection-token'], Recall);
      assert.equal(current.documents.length, 1);
      const currentDigest = call(['memory', 'show', 'native-recall'], Memory).document.digest;
      call(['cache', 'clear'], Ack);
      assert.equal(call(['cache', 'status'], CacheStatus).status, 'empty');
      assert.equal(call(['memory', 'recall', 'current-native-projection-token'], Recall).documents.length, 1);
      assert.equal(call(['memory', 'show', 'native-recall'], Memory).document.digest, currentDigest);
      call(['cache', 'clear'], Ack);
      assert.equal(call(['test', 'list'], CacheResult).cache.status, 'miss');
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
