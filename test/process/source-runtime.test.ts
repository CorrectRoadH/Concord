// 跨进程保证：原生模块与句柄——官方 Bun 复用 worker 时，文件 hook 释放持久句柄，内存缓存及调用环境保持隔离。
import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';

// @feature docs/engineering/testing/architecture.md#bun-测试引擎
test('reused official workers release native file handles and isolate memory caches and environments', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-files-' });
  const receipt = join(root, 'workers.json');
  const files = ['first', 'second'].map(name => join(root, `${name}.test.ts`));
  for (const file of files) yield* fs.writeFileString(file, `
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openHawdb, createMemoryHawdb } from ${JSON.stringify(new URL('../../src/base/cache/index.ts', import.meta.url).href)};
import { makeRuntimeEnvironment } from ${JSON.stringify(new URL('../../src/base/environment/index.ts', import.meta.url).href)};
test('file owns its native handles until after', () => {
  assert.equal(process.env.CONCORD_NATIVE_FILE_PROBE, undefined);
  process.env.CONCORD_NATIVE_FILE_PROBE = 'owned by this isolated file';
  const runtime = makeRuntimeEnvironment(process.cwd(), process.env);
  const durable = openHawdb(${JSON.stringify(join(root, 'cache.hawdb'))}, {readOnly:false, create:true}, runtime);
  after(() => durable.close());
  const memory = createMemoryHawdb(runtime);
  after(() => memory.close());
  const previous = existsSync(${JSON.stringify(receipt)}) ? JSON.parse(readFileSync(${JSON.stringify(receipt)}, 'utf8')) : [];
  assert.equal(durable.scan('code_cache').length, previous.length);
  durable.put('code_cache', [{key:String(previous.length), payload:'persisted'}]);
  assert.deepEqual(memory.scan('document_parse'), []);
  memory.put('document_parse', [{key:'file', payload:'private'}]);
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify([...previous, process.pid]));
});
`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [
    '--no-env-file', '--config=/dev/null', '--conditions=concord-source', 'test', '--preload',
    resolve('test/support/source-runtime.ts'), '--parallel=1', '--isolate', '--timeout=120000', ...files,
  ], { env: { ...process.env, NODE_TEST_CONTEXT: undefined, CONCORD_NATIVE_FILE_PROBE: undefined }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 0, text);
  const workers = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Int)))(yield* fs.readFileString(receipt));
  assert.equal(workers.length, 2);
  assert.equal(workers[0], workers[1], 'both native consumers ran before this worker exited');
})).pipe(Effect.provide(NodeServices.layer))));
