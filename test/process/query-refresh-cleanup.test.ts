// 跨进程保证：进程终止与信号——刷新清理只回收当前消费者的拥有进程，保护既有与邻居进程。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Fiber, FileSystem } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { isRefreshArguments, isRefreshCommand, refreshPids, settleRefreshes } from '../support/query-refresh-cleanup.ts';

// @feature docs/feature/local-data-engine/README.md
test('refresh ownership observes real source and JavaScript arguments and excludes neighbouring roots and roles', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-refresh with spaces-' });
  const root = join(directory, 'consumer with spaces');
  const pids: number[] = [];
  const spawn = Effect.fn('test.spawnRefresh')(function*(file: string, selectedRoot: string) {
    const pidFile = join(directory, String(pids.length));
    const child = yield* Effect.scoped(Effect.gen(function*() {
      const worker = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(ChildProcess.make(process.execPath, [file, selectedRoot, '["trace","gaps"]', '1', '120000'], { cwd: directory, env: { CONCORD_REFRESH_PID_FILE: pidFile }, extendEnv: true, stdin: 'ignore', stdout: 'ignore', stderr: 'inherit', killSignal: 'SIGKILL' }));
      yield* worker.exitCode;
    })).pipe(Effect.forkChild);
    yield* Effect.gen(function*() { while (!(yield* fs.exists(pidFile))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('5 seconds'));
    pids.push(Number(yield* fs.readFileString(pidFile)));
    return child;
  });
  for (const name of ['query-refresh-worker.ts', 'query-refresh-worker.js', 'query-scan-worker.ts']) yield* fs.writeFileString(join(directory, name), "require('node:fs').writeFileSync(process.env.CONCORD_REFRESH_PID_FILE, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
  const source = yield* spawn(join(directory, 'query-refresh-worker.ts'), root);
  const javascript = yield* spawn(join(directory, 'query-refresh-worker.js'), root);
  yield* spawn(join(directory, 'query-refresh-worker.ts'), `${root}-other`);
  yield* spawn(join(directory, 'query-scan-worker.ts'), root);
  assert.deepEqual((yield* refreshPids(root)).sort((a, b) => a - b), pids.slice(0, 2).sort((a, b) => a - b));
  yield* settleRefreshes(root, pids.slice(0, 2));
  for (const pid of pids) assert.doesNotThrow(() => process.kill(pid, 0));
  yield* settleRefreshes(root, [pids[0]!], 1);
  assert.throws(() => process.kill(pids[1]!, 0), { code: 'ESRCH' });
  for (const pid of [pids[0]!, ...pids.slice(2)]) assert.doesNotThrow(() => process.kill(pid, 0));
  const settling = yield* settleRefreshes(root).pipe(Effect.forkChild);
  yield* Fiber.interrupt(source);
  yield* Fiber.interrupt(javascript);
  yield* Fiber.join(settling).pipe(Effect.timeout('5 seconds'));
  for (const pid of pids.slice(0, 2)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  for (const pid of pids.slice(2)) assert.doesNotThrow(() => process.kill(pid, 0));
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/feature/local-data-engine/README.md
test('compiled refresh argument identity rejects a different role, root prefix and embedded command text', () => {
  const root = '/private/consumer with spaces';
  const command = ['/install with spaces/bin/concord', '--concord-internal', 'query-refresh-worker', root, '["trace","gaps"]', '1'];
  assert.equal(isRefreshArguments(command, root), true);
  assert.equal(isRefreshArguments(command, '/private/consumer'), false);
  assert.equal(isRefreshArguments([command[0]!, command[1]!, 'query-scan-worker', ...command.slice(3)], root), false);
  assert.equal(isRefreshArguments(['/bun', '-e', command.join(' ')], root), false);
  assert.equal(isRefreshCommand(command.join(' '), root), true);
  assert.equal(isRefreshCommand(command.join(' '), '/private/consumer'), false);
  assert.equal(isRefreshCommand(['/runtime with spaces/bin/bun', '--no-env-file', '--config=/dev/null', '--conditions=concord-source', '/source with spaces/src/entry/server/query-refresh-worker.ts', ...command.slice(3), '120000'].join(' '), root), true);
  assert.equal(isRefreshCommand(['/runtime with spaces/bin/node', '/consumer with spaces/app/entry/server/query-refresh-worker.js', ...command.slice(3)].join(' '), root), true);
  assert.equal(isRefreshCommand([...command.slice(0, 3), `${root} ["extra"] 1`, ...command.slice(4)].join(' '), root), false);
  assert.equal(isRefreshCommand(['/bun', '-e', command.join(' ')].join(' '), root), false);
});
