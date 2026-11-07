// 跨进程保证：进程终止与信号——测量子进程继承普通输出文件，超时保留SIGKILL诊断，中断后真实PID已退出。
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Fiber, FileSystem } from 'effect';
import { isRefreshArguments, isRefreshCommand, mustRun, refreshPids, settleRefreshes, timedRun } from '../../scripts/perf/process.ts';
import { workDirectory } from '../../scripts/perf/workspace.ts';

// @feature docs/feature/local-sdlc/README.md
test('measured commands inherit regular output files and preserve observed exit timing', () => Effect.runPromise(Effect.gen(function*() {
  const outputDir = yield* workDirectory('concord-perf-fds-', false);
  const result = yield* timedRun([process.execPath, '-e', "const fs = require('node:fs'); console.log(fs.fstatSync(1).isFile()); console.error(fs.fstatSync(2).isFile()); process.exitCode = 7"], { cwd: outputDir, outputDir });
  assert.equal(result.stdout, 'true\n');
  assert.equal(result.stderr, 'true\n');
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(result.ms, result.endedAtMs - result.startedAtMs);
  assert.ok(result.ms > 0);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/engineering/performance/README.md
test('refresh ownership observes real source and baseline arguments and excludes neighbouring roots and roles', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* workDirectory('concord-perf-refresh with spaces-', false);
  const root = join(directory, 'consumer with spaces');
  const pids: number[] = [];
  const spawn = Effect.fn('test.spawnRefresh')(function*(file: string, selectedRoot: string) {
    const pidFile = join(directory, String(pids.length));
    const child = yield* timedRun([process.execPath, file, selectedRoot, '["trace","gaps"]', '1', '120000'], { cwd: directory, outputDir: directory, env: { CONCORD_PERF_PID_FILE: pidFile } }).pipe(Effect.forkChild);
    yield* Effect.gen(function*() { while (!(yield* fs.exists(pidFile))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('5 seconds'));
    pids.push(Number(yield* fs.readFileString(pidFile)));
    return child;
  });
  for (const name of ['query-refresh-worker.ts', 'query-refresh-worker.js', 'query-scan-worker.ts']) yield* fs.writeFileString(join(directory, name), "require('node:fs').writeFileSync(process.env.CONCORD_PERF_PID_FILE, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);");
  const source = yield* spawn(join(directory, 'query-refresh-worker.ts'), root);
  const baseline = yield* spawn(join(directory, 'query-refresh-worker.js'), root);
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
  yield* Fiber.interrupt(baseline);
  yield* Fiber.join(settling).pipe(Effect.timeout('5 seconds'));
  for (const pid of pids.slice(0, 2)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  for (const pid of pids.slice(2)) assert.doesNotThrow(() => process.kill(pid, 0));
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/engineering/performance/README.md
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
  assert.equal(isRefreshCommand(['/runtime with spaces/bin/node', '/baseline with spaces/app/dist/entry/server/query-refresh-worker.js', ...command.slice(3)].join(' '), root), true);
  assert.equal(isRefreshCommand([...command.slice(0, 3), `${root} ["extra"] 1`, ...command.slice(4)].join(' '), root), false);
  assert.equal(isRefreshCommand(['/bun', '-e', command.join(' ')].join(' '), root), false);
});

// @feature docs/feature/local-sdlc/README.md
test('sample deadlines retain SIGKILL diagnostics and interruption reaps the owned process', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const outputDir = yield* workDirectory('concord-perf-cancel-', false);
  const timedOut = yield* timedRun([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { cwd: outputDir, outputDir, timeoutMs: 30 });
  assert.equal(timedOut.exitCode, null);
  assert.equal(timedOut.signal, 'SIGKILL');
  const pidFile = join(outputDir, 'pid');
  const running = yield* timedRun([process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", pidFile], { cwd: outputDir, outputDir }).pipe(Effect.forkChild);
  yield* Effect.gen(function*() { while (!(yield* fs.exists(pidFile))) yield* Effect.sleep('10 millis'); }).pipe(Effect.timeout('10 seconds'));
  const pid = Number(yield* fs.readFileString(pidFile));
  yield* Fiber.interrupt(running);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/feature/local-sdlc/README.md
test('ordinary commands drain both streams and reject failures and deadlines', () => Effect.runPromise(Effect.gen(function*() {
  const outputDir = yield* workDirectory('concord-perf-command-', false);
  const options = { cwd: outputDir, outputDir };
  const output = yield* mustRun([process.execPath, '-e', "process.stdout.write('x'.repeat(100000)); process.stderr.write('y'.repeat(100000))"], options);
  assert.equal(output.stdout.length, 100000);
  assert.equal(output.stderr.length, 100000);
  const failed = yield* Effect.result(mustRun([process.execPath, '-e', "console.error('command failed'); process.exitCode = 8"], options));
  assert.equal(failed._tag, 'Failure');
  if (failed._tag === 'Failure') assert.match(failed.failure.message, /exited 8: command failed/u);
  const timeout = yield* Effect.result(mustRun([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { ...options, timeoutMs: 30 }));
  assert.equal(timeout._tag, 'Failure');
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
