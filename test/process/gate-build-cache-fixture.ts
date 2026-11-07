import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NodeServices } from '@effect/platform-node';
import type { Scope} from 'effect';
import { Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { gateBuildDigest } from '../../scripts/gate-build-cache.ts';
import { nativeSourceFiles } from '../../src/base/installation/native-artifact.ts';
import { readNativeRelease } from '../../src/base/installation/native-release.ts';
import { HAWDB_ABI, HAWDB_REVISION, hawdbTarget } from '../../src/base/installation/hawdb-native-contract.ts';
import { tmpdir } from '../support/temporary.ts';

type Requirements = FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;
const cacheTest = (name: string, body: (root: string) => Effect.Effect<void, unknown, Requirements>) =>
  test(name, { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-build-cache-test-' });
    yield* body(root);
  })).pipe(Effect.provide(NodeServices.layer))));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const Reply = Schema.Struct({ cache: Schema.Literals(['hit', 'miss']), builds: Schema.Number, digest: Schema.String, packageRoot: Schema.String });
const fixture = Effect.fn('test.cache.fixture')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const checkout = join(root, 'checkout'), seedRoot = join(root, 'compiled-package'), seed = join(seedRoot, 'app'), cache = join(root, 'cache');
  yield* fs.makeDirectory(seed, { recursive: true });
  for (const path of ['bin/concord', 'runtime/node', 'runtime/rg', 'licenses/NODE-LICENSE', 'concord-1.0.0-linux-x64.tar.gz']) {
    yield* fs.makeDirectory(resolve(seedRoot, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(seedRoot, path), 'compiled archive fixture');
  }
  yield* fs.writeFileString(join(seedRoot, 'concord-1.0.0-linux-x64.tar.gz.sha256'), hash('compiled archive fixture') + '  concord-1.0.0-linux-x64.tar.gz\n');
  yield* fs.makeDirectory(checkout);
  for (const path of nativeSourceFiles) {
    const bytes = yield* fs.readFile(resolve(path));
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    yield* fs.writeFile(join(checkout, path), bytes);
  }
  const pkg = { name: 'gate-cache-fixture', version: '1.0.0', type: 'module', bin: { concord: 'dist/entry/cli/entry.js' }, dependencies: {} };
  yield* fs.writeFileString(join(seed, 'package.json'), JSON.stringify(pkg));
  const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['install', '--lockfile-only', '--ignore-scripts', '--offline'], { cwd: seed, stdout: 'ignore', stderr: 'inherit', stdin: 'ignore' }));
  assert.equal(Number(code), 0);
  yield* fs.writeFileString(join(seed, 'pnpm-workspace.yaml'), 'allowBuilds: {}\n');
  for (const path of ['dist/entry/cli/entry.js', 'dist/entry/cli/cli.js', 'dist/web/index.html', 'dist/preview/index.html',
    'dist/herdr-mod/main.js', 'dist/herdr-mod/mod.json', 'dist/herdr-mod/preview.png', 'dist/build-identity.json',
    'docs/example.md', 'templates/example.md', 'skills/example.md', 'dist/p5-types/index.d.ts']) {
    yield* fs.makeDirectory(resolve(seed, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(seed, path), 'compiled fixture\n');
  }
  yield* fs.writeFileString(join(seed, 'dist/build-identity.json'), JSON.stringify({ format: 'concord.build-source/v1', commit: '0'.repeat(40), dirty: true }));
  const native = join(seed, 'dist/native', hawdbTarget());
  yield* fs.makeDirectory(native, { recursive: true });
  const binary = 'external compiler fixture binary', notices = 'external compiler fixture notices';
  yield* fs.writeFileString(join(native, 'hawdb.node'), binary);
  yield* fs.writeFileString(join(native, 'THIRD-PARTY-NOTICES.txt'), notices);
  yield* fs.writeFileString(join(native, 'artifact.json'), JSON.stringify({ target: hawdbTarget(), abi: HAWDB_ABI, revision: HAWDB_REVISION,
    sourceDigest: readNativeRelease(checkout).sourceDigest, cargoLockDigest: readNativeRelease(checkout).cargoLockDigest,
    binarySha256: hash(binary), noticesSha256: hash(notices), portable: false, testHooks: false }));
  yield* fs.writeFileString(join(checkout, 'package.json'), JSON.stringify(pkg));
  yield* fs.makeDirectory(join(checkout, 'src'), { recursive: true });
  yield* fs.writeFileString(join(checkout, 'src/input.ts'), 'export const value = 1;\n');
  const compiler = join(root, 'external-vp.mts');
  yield* fs.writeFileString(compiler, `import { appendFileSync, cpSync, existsSync, writeFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(join(root, 'builds'))}, 'build\\n');
writeFileSync(process.argv[3] + '.started', 'started');
const parent = process.ppid;
while (process.argv[4] === 'blocked' && !existsSync(process.argv[3] + '.release')) {
  if (process.ppid !== parent) process.exit(10);
  await new Promise(resolve => setTimeout(resolve, 10));
}
if (process.argv[4] === 'fail') process.exit(9);
cpSync(${JSON.stringify(seedRoot)}, process.argv[2], { recursive: true });
`);
  const harness = join(root, 'gate-process.ts');
  yield* fs.writeFileString(harness, `import { NodeRuntime, NodeServices } from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
import { Effect, FileSystem } from ${JSON.stringify(import.meta.resolve('effect'))};
import { ChildProcess, ChildProcessSpawner } from ${JSON.stringify(import.meta.resolve('effect/process'))};
import { prepareGateBuildCache } from ${JSON.stringify(pathToFileURL(resolve('scripts/gate-build-cache.ts')).href)};
Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem, spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const cached = yield* prepareGateBuildCache(${JSON.stringify(checkout)}, ${JSON.stringify(cache)});
  yield* fs.writeFileString(process.argv[2] + '.admitted', cached.packageRoot);
  const result = yield* cached.build(output => spawner.exitCode(ChildProcess.make(process.execPath, [${JSON.stringify(compiler)}, output, process.argv[2], process.argv[3] ?? ''], { stdout: 'inherit', stderr: 'inherit' })).pipe(Effect.map(Number)));
  console.log('RESULT ' + JSON.stringify(result));
  yield* fs.writeFileString(process.argv[2] + '.ready', cached.packageRoot);
  while (process.argv[3] === 'hold' && !(yield* fs.exists(process.argv[2] + '.release'))) yield* Effect.sleep('10 millis');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
`);
  return { checkout, cache, harness, seed: seedRoot };
});
const waitFile = (path: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  while (!(yield* fs.exists(path))) yield* Effect.sleep('10 millis');
}).pipe(Effect.timeout(Duration.seconds(15)));
const start = Effect.fn('test.cache.start')(function*(harness: string, marker: string, mode = '') {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [harness, marker, mode], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  let text = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(child.all), chunk => Effect.sync(() => { text += chunk; })).pipe(Effect.forkScoped);
  return { child, finish: Effect.gen(function*() {
    const code = Number(yield* child.exitCode);
    yield* Fiber.join(drain);
    return { code, text, reply: () => {
      const line = text.split('\n').find(line => line.startsWith('RESULT '));
      assert.ok(line, text);
      return Schema.decodeUnknownSync(Schema.fromJsonString(Reply), { onExcessProperty: 'error' })(line.slice(7));
    } };
  }) };
});
const build = Effect.fn('test.cache.build')(function*(harness: string, marker: string, mode = '') {
  const process = yield* start(harness, marker, mode);
  const result = yield* process.finish;
  assert.equal(result.code, 0, result.text);
  return result.reply();
});
const published = (cache: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.readDirectory(cache)).filter(name => /^[a-f0-9]{64}$/u.test(name)).sort();
});
export { assert, createHash, NodeServices, Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream, ChildProcess, ChildProcessSpawner, join, resolve, pathToFileURL, test, gateBuildDigest, nativeSourceFiles, HAWDB_ABI, HAWDB_REVISION, hawdbTarget, tmpdir, cacheTest, hash, Reply, fixture, waitFile, start, build, published };
export type { Scope, Requirements };
