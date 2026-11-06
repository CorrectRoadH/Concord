import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NodeServices } from '@effect/platform-node';
import type { Scope} from 'effect';
import { Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { gateBuildDigest } from '../../scripts/gate-build-cache.ts';
import { nativeSourceFiles } from '../../src/base/installation/native-artifact.ts';
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
  const sources: string[] = [];
  for (const path of [...nativeSourceFiles, 'native/hawdb/Cargo.lock']) {
    const bytes = yield* fs.readFile(resolve(path));
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    yield* fs.writeFile(join(checkout, path), bytes);
    if (nativeSourceFiles.includes(path as typeof nativeSourceFiles[number])) sources.push(`${path}\0${hash(bytes)}\n`);
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
    sourceDigest: hash(sources.join('')), cargoLockDigest: hash(yield* fs.readFile(join(checkout, 'native/hawdb/Cargo.lock'))),
    binarySha256: hash(binary), noticesSha256: hash(notices), portable: false }));
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
import { ChildProcess, ChildProcessSpawner } from ${JSON.stringify(import.meta.resolve('effect/unstable/process'))};
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

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('two gates share one build, reuse uncommitted bytes and rebuild after cache deletion without checkout output', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { checkout, cache, harness } = yield* fixture(root);
  const firstMarker = join(root, 'one'), secondMarker = join(root, 'two');
  const first = yield* start(harness, firstMarker, 'blocked');
  yield* waitFile(`${firstMarker}.started`);
  const second = yield* start(harness, secondMarker);
  yield* waitFile(`${secondMarker}.admitted`);
  assert.equal(yield* fs.exists(`${secondMarker}.started`), false, 'live builder was displaced');
  yield* fs.writeFileString(`${firstMarker}.release`, 'release');
  const [a, b] = yield* Effect.all([first.finish, second.finish], { concurrency: 'unbounded' });
  assert.equal(a.code, 0, a.text); assert.equal(b.code, 0, b.text);
  assert.equal(a.reply().cache, 'miss'); assert.equal(b.reply().cache, 'hit');
  assert.equal(a.reply().packageRoot, b.reply().packageRoot);
  assert.equal(yield* fs.readFileString(join(root, 'builds')), 'build\n');
  const input = join(checkout, 'src/input.ts');
  yield* fs.writeFileString(input, 'export const value = 2;\n');
  const changed = yield* build(harness, join(root, 'changed'));
  assert.equal(changed.cache, 'miss'); assert.notEqual(changed.digest, a.reply().digest);
  assert.equal((yield* build(harness, join(root, 'unchanged'))).cache, 'hit');
  yield* fs.remove(cache, { recursive: true });
  const rebuilt = yield* build(harness, join(root, 'deleted'));
  assert.equal(rebuilt.cache, 'miss'); assert.equal(rebuilt.digest, changed.digest);
  assert.equal(yield* fs.readFileString(join(root, 'builds')), 'build\nbuild\nbuild\n');
  assert.equal(yield* fs.exists(join(checkout, 'dist')), false);
  assert.equal(yield* fs.exists(join(checkout, 'node_modules')), false);
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('failed and changing builds publish nothing; a dead builder is recovered by a new process', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { checkout, cache, harness } = yield* fixture(root);
  const failed = yield* start(harness, join(root, 'failed'), 'fail');
  assert.notEqual((yield* failed.finish).code, 0);
  assert.deepEqual(yield* published(cache), []);
  const marker = join(root, 'changing');
  const changing = yield* start(harness, marker, 'blocked');
  yield* waitFile(`${marker}.started`);
  yield* fs.writeFileString(join(checkout, 'src/input.ts'), 'export const value = 3;\n');
  yield* fs.writeFileString(`${marker}.release`, 'release');
  const changed = yield* changing.finish;
  assert.notEqual(changed.code, 0, changed.text);
  assert.match(changed.text, /Build inputs changed/u);
  assert.deepEqual(yield* published(cache), []);
  const deadMarker = join(root, 'dead');
  const dead = yield* start(harness, deadMarker, 'blocked');
  yield* waitFile(`${deadMarker}.started`);
  yield* dead.child.kill({ killSignal: 'SIGKILL' });
  assert.equal(Exit.isFailure(yield* dead.finish.pipe(Effect.exit)), true, 'SIGKILL must terminate the builder');
  const recovery = yield* build(harness, join(root, 'recovery'));
  assert.equal(recovery.cache, 'miss');
  assert.deepEqual(yield* published(cache), [recovery.digest]);
  assert.deepEqual((yield* fs.readDirectory(cache)).filter(name => name.startsWith('.staging-')), []);
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('prune retains the latest four digests plus leased older packages until the last gate exits', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { checkout, cache, harness } = yield* fixture(root);
  const marker = join(root, 'holder');
  const holder = yield* start(harness, marker, 'hold');
  yield* waitFile(`${marker}.ready`);
  const heldRoot = yield* fs.readFileString(`${marker}.ready`);
  const newest: string[] = [];
  for (let index = 1; index <= 5; index++) {
    yield* fs.writeFileString(join(checkout, 'src/input.ts'), `export const value = ${index + 10};\n`);
    newest.push((yield* build(harness, join(root, `new-${index}`))).digest);
  }
  assert.equal(yield* fs.exists(heldRoot), true);
  assert.deepEqual(yield* published(cache), [heldRoot.split('/').at(-1)!, ...newest.slice(-4)].sort());
  yield* fs.writeFileString(`${marker}.release`, 'release');
  const done = yield* holder.finish;
  assert.equal(done.code, 0, done.text);
  assert.deepEqual(yield* published(cache), newest.slice(-4).sort());
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('digest includes untracked resources and build configuration while excluding tests and outputs', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { checkout } = yield* fixture(root);
  const original = yield* gateBuildDigest(checkout);
  for (const path of ['test/new.test.ts', 'concord/main.js', 'native/hawdb/target/release/lib.node', '.git/config']) {
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(checkout, path), 'ignored');
  }
  assert.equal(yield* gateBuildDigest(checkout), original);
  for (const path of ['src/input.ts', 'web/new.ts', 'scripts/new.ts', 'docs/new.md', 'templates/new.md', 'skills/new.md', 'README.md', 'pnpm-lock.yaml', 'tsconfig.web.json', 'vite.preview.config.ts', '.node-version', 'runtime-deps.json']) {
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    const before = yield* gateBuildDigest(checkout);
    yield* fs.writeFileString(join(checkout, path), 'uncommitted bytes');
    assert.notEqual(yield* gateBuildDigest(checkout), before, path);
  }
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('a hit verifies package bytes and rejects incomplete or escaping compiler output without publication', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { cache, harness, seed } = yield* fixture(root);
  const result = yield* build(harness, join(root, 'initial'));
  yield* fs.writeFileString(join(result.packageRoot, 'app/dist/web/index.html'), 'corrupt');
  const hit = yield* start(harness, join(root, 'corrupt'));
  const hitResult = yield* hit.finish;
  assert.notEqual(hitResult.code, 0); assert.match(hitResult.text, /integrity validation/u);
  yield* fs.remove(cache, { recursive: true });
  yield* fs.remove(join(seed, 'app/dist/web/index.html'));
  const incomplete = yield* start(harness, join(root, 'incomplete'));
  assert.notEqual((yield* incomplete.finish).code, 0);
  assert.deepEqual(yield* published(cache), []);
  yield* fs.writeFileString(join(seed, 'app/dist/web/index.html'), 'compiled');
  yield* fs.symlink(seed, join(seed, 'absolute-link'));
  const escaping = yield* start(harness, join(root, 'escaping'));
  assert.notEqual((yield* escaping.finish).code, 0);
  assert.deepEqual(yield* published(cache), []);
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('archive target separates full cache keys while application inputs remain target independent', root => Effect.gen(function*() {
  const { checkout } = yield* fixture(root);
  const before = process.env.CONCORD_TARGET;
  try {
    process.env.CONCORD_TARGET = 'linux-x64';
    const linux = yield* gateBuildDigest(checkout);
    const application = yield* gateBuildDigest(checkout, false);
    process.env.CONCORD_TARGET = 'darwin-arm64';
    assert.notEqual(yield* gateBuildDigest(checkout), linux);
    assert.equal(yield* gateBuildDigest(checkout, false), application);
  } finally {
    if (before === undefined) delete process.env.CONCORD_TARGET;
    else process.env.CONCORD_TARGET = before;
  }
}));

// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('an active installation marker is mutable lifecycle state and does not corrupt a cache hit', root => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const { harness } = yield* fixture(root);
  const initial = yield* build(harness, join(root, 'initial'));
  const markers = join(initial.packageRoot, '.in-use');
  yield* fs.makeDirectory(markers);
  yield* fs.writeFileString(join(markers, String(process.pid)), '');
  const hit = yield* build(harness, join(root, 'active'));
  assert.equal(hit.cache, 'hit');
  assert.equal(hit.packageRoot, initial.packageRoot);
  assert.equal(yield* fs.exists(join(markers, String(process.pid))), true);
}));
