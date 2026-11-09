// 跨进程保证：OS 锁与互斥——两个真实构建进程仅启动一次builder，死builder租约可恢复且不发布失败或漂移产物。
import { assert, createHash, NodeServices, Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream, ChildProcess, ChildProcessSpawner, join, resolve, pathToFileURL, test, buildDigest, nativeSourceFiles, HAWDB_ABI, HAWDB_REVISION, hawdbTarget, tmpdir, cacheTest, hash, Reply, fixture, waitFile, start, build, published, type Scope, type Requirements } from './build-cache-fixture.ts';


// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('two callers share one build, reuse uncommitted bytes and rebuild after cache deletion without checkout output', root => Effect.gen(function*() {
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
