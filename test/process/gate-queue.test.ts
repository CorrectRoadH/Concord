// 跨进程保证：OS 锁与互斥——同机门禁等待真实持有者，持有者退出或崩溃后才进入且等待时间不计入执行。
import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Deferred, Effect, Fiber, FileSystem, Stream } from 'effect';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/testing/README.md#共享资源与同步
test('machine gate queue reports its owner, waits for completion and recovers a killed owner', { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-gate-queue-' });
  const fixture = join(root, 'queue.ts'), slot = join(root, 'slot');
  yield* fs.writeFileString(fixture, `import { NodeRuntime } from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};
import { existsSync, writeFileSync } from 'node:fs';
import { withGateQueue } from ${JSON.stringify(pathToFileURL(resolve('scripts/gate-queue.ts')).href)};
const [slot, marker] = process.argv.slice(2);
withGateQueue(Effect.gen(function*() {
  writeFileSync(marker, JSON.stringify({pid:process.pid, waitMs:Number(process.env.CONCORD_GATE_QUEUE_WAIT_MS)}));
  while (!existsSync(marker + '.release')) yield* Effect.sleep('10 millis');
  writeFileSync(marker + '.done', 'done');
}), slot).pipe(NodeRuntime.runMain);
`);
  const waitFile = (path: string) => Effect.gen(function*() {
    while (!(yield* fs.exists(path))) yield* Effect.sleep('10 millis');
  }).pipe(Effect.timeout('10 seconds'));
  const start = Effect.fn('test.gate.queue.start')(function*(name: string) {
    const marker = join(root, name);
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [fixture, slot, marker], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    const queued = yield* Deferred.make<void>();
    let text = '';
    const drain = yield* Stream.runForEach(Stream.decodeText(child.all), chunk => Effect.gen(function*() {
      text += chunk;
      if (text.includes('# Gate queued:')) yield* Deferred.succeed(queued, undefined);
    })).pipe(Effect.forkScoped);
    return { child, marker, queued, finish: Effect.gen(function*() {
      const code = yield* child.exitCode;
      yield* Fiber.join(drain);
      assert.equal(Number(code), 0, text);
      return text;
    }) };
  });
  const first = yield* start('first');
  yield* waitFile(first.marker);
  const second = yield* start('second');
  yield* Deferred.await(second.queued).pipe(Effect.timeout('10 seconds'));
  assert.equal(yield* fs.exists(second.marker), false, 'waiting gate cannot execute before its owner finishes');
  yield* fs.writeFileString(first.marker + '.release', 'release');
  yield* first.finish;
  yield* waitFile(second.marker);
  assert.equal(yield* fs.exists(first.marker + '.done'), true);
  yield* fs.writeFileString(second.marker + '.release', 'release');
  const output = yield* second.finish;
  assert.match(output, /# Gate queued: waiting for pid=\d+ host=/u);
  assert.match(output, /# Gate queue wait: [\d.]+s; excluded from gate wallclock/u);
  const dead = yield* start('dead');
  yield* waitFile(dead.marker);
  const successor = yield* start('successor');
  yield* Deferred.await(successor.queued).pipe(Effect.timeout('10 seconds'));
  assert.equal(yield* fs.exists(successor.marker), false);
  yield* dead.child.kill({ killSignal: 'SIGKILL' });
  yield* dead.child.exitCode.pipe(Effect.ignore);
  yield* waitFile(successor.marker);
  assert.equal(yield* fs.exists(dead.marker + '.done'), false, 'crashed owner did not finish its body');
  yield* fs.writeFileString(successor.marker + '.release', 'release');
  yield* successor.finish;
  assert.equal(yield* fs.exists(join(slot, 'publication.lease')), false, 'the final owner releases its slot');
})).pipe(Effect.provide(NodeServices.layer))));
