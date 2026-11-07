// 跨进程保证：服务与 IPC——CLI fixture 在官方测试文件退出前停止所有消费者服务，确认 PID 消失后才删除目录。
import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join, resolve } from 'node:path';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('the CLI fixture stops every real consumer service before its test file exits', { timeout: 45_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-cli-cleanup-' });
  const file = join(root, 'fixture.test.ts'), receipt = join(root, 'pids.json');
  yield* fs.writeFileString(file, `import { consumer, call, write, test, CheckOutput } from ${JSON.stringify(new URL('../support/cli-fixture.ts', import.meta.url).href)};
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
test('two consumer services', async () => {
  const pids = [];
  for (const name of ['first', 'second']) {
    const root = await consumer(name);
    await call(root, ['docs', 'check'], CheckOutput);
    pids.push(JSON.parse(readFileSync(join(root, '.git/concord/server/current.json'), 'utf8')).pid);
  }
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(pids));
});
`);
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [resolve('scripts/test-built.ts'), '--suite=node', file], {
    env: { ...process.env, CONCORD_TEST_TIMINGS: undefined, CONCORD_TEST_COMPILE_CACHE: undefined }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [text, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.all)), child.exitCode], { concurrency: 'unbounded' });
  assert.equal(Number(code), 0, text);
  const pids = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Int)))(yield* fs.readFileString(receipt));
  assert.equal(pids.length, 2);
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `consumer service ${pid} survived official runner exit`);
})).pipe(Effect.provide(NodeServices.layer))));
