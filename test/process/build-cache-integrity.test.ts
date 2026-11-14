// 跨进程保证：外部程序——独立构建进程拒绝损坏命中及compiler产生的缺失或越界产物，不发布候选。
import { assert, createHash, NodeServices, Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream, ChildProcess, ChildProcessSpawner, join, resolve, pathToFileURL, test, buildDigest, nativeSourceFiles, HAWDB_REVISION, hawdbTarget, tmpdir, cacheTest, hash, Reply, fixture, waitFile, start, build, published, type Scope, type Requirements } from './build-cache-fixture.ts';


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
    const linux = yield* buildDigest(checkout);
    const application = yield* buildDigest(checkout, false);
    process.env.CONCORD_TARGET = 'darwin-arm64';
    assert.notEqual(yield* buildDigest(checkout), linux);
    assert.equal(yield* buildDigest(checkout, false), application);
  } finally {
    if (before === undefined) delete process.env.CONCORD_TARGET;
    else process.env.CONCORD_TARGET = before;
  }
}));
