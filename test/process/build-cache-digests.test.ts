// 跨进程保证：OS 锁与互斥——旧构建被真实构建进程持有时prune保留，最后持有者退出后只留最新四份。
import { assert, createHash, NodeServices, Duration, Effect, Exit, Fiber, FileSystem, Schema, Stream, ChildProcess, ChildProcessSpawner, join, resolve, pathToFileURL, test, buildDigest, nativeSourceFiles, HAWDB_REVISION, hawdbTarget, tmpdir, cacheTest, hash, Reply, fixture, waitFile, start, build, published, type Scope, type Requirements } from './build-cache-fixture.ts';


// @feature docs/engineering/build/architecture.md#共享构建缓存
cacheTest('prune retains the latest four digests plus leased older packages until the last caller exits', root => Effect.gen(function*() {
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
  const original = yield* buildDigest(checkout);
  for (const path of ['test/new.test.ts', 'concord/main.js', '.artifacts/lib/libhawdb_ffi.so', '.git/config']) {
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    yield* fs.writeFileString(join(checkout, path), 'ignored');
  }
  assert.equal(yield* buildDigest(checkout), original);
  for (const path of ['src/input.ts', 'web/new.ts', 'scripts/new.ts', 'patches/typescript.patch', 'docs/new.md', 'templates/new.md', 'skills/new.md', 'README.md', 'bun.lock', 'tsconfig.web.json', 'vite.preview.config.ts', '.bun-version', 'runtime-deps.json']) {
    yield* fs.makeDirectory(resolve(checkout, path, '..'), { recursive: true });
    const before = yield* buildDigest(checkout);
    yield* fs.writeFileString(join(checkout, path), 'uncommitted bytes');
    assert.notEqual(yield* buildDigest(checkout), before, path);
  }
}));
