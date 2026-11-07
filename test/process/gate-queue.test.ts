// 跨进程保证：OS 锁与互斥——同机门禁等待真实持有者，持有者退出或崩溃后才进入且等待时间不计入执行。
import assert from 'node:assert/strict';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NodeServices } from '@effect/platform-node';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { Deferred, Effect, Fiber, FileSystem, Stream } from 'effect';
import { tmpdir } from '../support/temporary.ts';
import { gateSlotCapacity, withGateQueue } from '../../scripts/gate-queue.ts';

// @feature docs/engineering/testing/README.md#共享资源与同步
test('machine gate queue reports its owner, waits for completion and recovers a killed owner', { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-gate-queue-' });
  const fixture = join(root, 'queue.ts'), slot = join(root, 'slot');
  yield* fs.writeFileString(fixture, `import { NodeRuntime } from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
import { Effect } from ${JSON.stringify(import.meta.resolve('effect'))};
import { existsSync, writeFileSync } from 'node:fs';
import { gateSlotCapacity, withGateQueue } from ${JSON.stringify(pathToFileURL(resolve('scripts/gate-queue.ts')).href)};
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
  assert.deepEqual(JSON.parse(yield* fs.readFileString(join(slot, 'requests.json'))).requests, [], 'the final owner releases its slot');
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/README.md#共享资源与同步
test('the real gate queues full, file and title selections behind an all-slot owner', { timeout: 30_000 }, t => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-targeted-queue-' });
  const slot = join(root, 'slot'), bin = join(root, 'bin'), marker = join(root, 'task-entered');
  yield* fs.makeDirectory(bin);
  // Fake only the task executor/systemd boundary; selection and queue are real.
  yield* fs.writeFileString(join(bin, 'vp'), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(process.env.GATE_TEST_MARKER, 'entered\\n');\n`);
  yield* fs.writeFileString(join(bin, 'systemctl'), `#!${process.execPath}\nprocess.exitCode = 1;\n`);
  yield* fs.chmod(join(bin, 'vp'), 0o755);
  yield* fs.chmod(join(bin, 'systemctl'), 0o755);
  const env = { ...process.env, CONCORD_GATE_QUEUE_DIRECTORY: slot, CONCORD_GATE_MEMORY_MAX: String(7 * 1024 ** 3),
    PATH: `${bin}:${process.env.PATH}`, GATE_TEST_MARKER: marker, CONCORD_GATE_SCOPE: undefined };
  for (const args of [[], [resolve('test/model/gate-resources.test.ts')], ['--test-name-pattern=queue-entry-probe']]) {
    const owned = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
    const holder = yield* withGateQueue(Deferred.succeed(owned, undefined).pipe(Effect.andThen(Deferred.await(release))), slot).pipe(Effect.forkScoped);
    yield* Deferred.await(owned);
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [resolve('scripts/gate.ts'), ...args], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    const queued = yield* Deferred.make<void>();
    let text = '';
    const drain = yield* Stream.runForEach(Stream.decodeText(child.all), chunk => Effect.gen(function*() {
      text += chunk;
      if (text.includes('# Gate queued:')) yield* Deferred.succeed(queued, undefined);
    })).pipe(Effect.forkScoped);
    yield* Deferred.await(queued).pipe(Effect.timeout('10 seconds'));
    assert.equal(yield* fs.exists(marker), false, 'all-slot owner prevents any later gate from starting');
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(holder);
    yield* child.exitCode;
    yield* Fiber.join(drain);
    assert.match(text, /# Gate results:/u, text);
    assert.match(text, new RegExp(`# Gate slots: ${args.length ? 1 : gateSlotCapacity()}/${gateSlotCapacity()}`), text);
    assert.equal(yield* fs.exists(marker), true);
    yield* fs.remove(marker);
  }
  assert.deepEqual(JSON.parse(yield* fs.readFileString(join(slot, 'requests.json'))).requests, []);
})).pipe(Effect.provide(NodeServices.layer)), { signal: t.signal }));

// @feature docs/engineering/performance/README.md#开发与交付流程
test('the real reference benchmark waits for the gate slot while comparison arguments proceed', { timeout: 30_000 }, () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-reference-queue-' });
  const slot = join(root, 'slot');
  const owned = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
  const holder = yield* withGateQueue(Effect.gen(function*() {
    yield* Deferred.succeed(owned, undefined);
    yield* Deferred.await(release);
  }), slot).pipe(Effect.forkScoped);
  yield* Deferred.await(owned);
  const reference = yield* spawner.spawn(ChildProcess.make(process.execPath, ['scripts/bench.ts', '--reference', '--samples=0'], {
    env: { ...process.env, CONCORD_GATE_QUEUE_DIRECTORY: slot }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const queued = yield* Deferred.make<void>();
  let referenceText = '';
  const drain = yield* Stream.runForEach(Stream.decodeText(reference.all), chunk => Effect.gen(function*() {
    referenceText += chunk;
    if (referenceText.includes('# Gate queued:')) yield* Deferred.succeed(queued, undefined);
  })).pipe(Effect.forkScoped);
  yield* Deferred.await(queued).pipe(Effect.timeout('10 seconds'));
  assert.doesNotMatch(referenceText, /Decode sample count/u, 'reference arguments are not executed while a gate owns the slot');
  const comparison = yield* spawner.spawn(ChildProcess.make(process.execPath, ['scripts/bench.ts', '--compare=HEAD', '--samples=0'], {
    env: { ...process.env, CONCORD_GATE_QUEUE_DIRECTORY: slot }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const [comparisonText, comparisonCode] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(comparison.all)), comparison.exitCode,
  ], { concurrency: 'unbounded' });
  assert.equal(Number(comparisonCode), 1);
  assert.match(comparisonText, /Decode sample count/u);
  assert.doesNotMatch(comparisonText, /# Gate queued:/u);
  yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(holder);
  assert.equal(Number(yield* reference.exitCode), 1);
  yield* Fiber.join(drain);
  assert.match(referenceText, /Decode sample count/u);
  assert.deepEqual(JSON.parse(yield* fs.readFileString(join(slot, 'requests.json'))).requests, []);
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/README.md#共享资源与同步
test('machine slots admit concurrent targets atomically in FIFO order and reclaim cancelled or dead requests', { timeout: 30_000 }, t => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  assert.equal(gateSlotCapacity(1), 1);
  assert.equal(gateSlotCapacity(16), 4);
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-gate-slots-' });
  const fixture = join(root, 'slots.ts'), slot = join(root, 'slot');
  yield* fs.writeFileString(fixture, `import {NodeRuntime} from ${JSON.stringify(import.meta.resolve('@effect/platform-node'))};
import {Effect} from ${JSON.stringify(import.meta.resolve('effect'))};
import {existsSync, writeFileSync} from 'node:fs';
import {withGateQueue} from ${JSON.stringify(pathToFileURL(resolve('scripts/gate-queue.ts')).href)};
const [slot, marker, demand] = process.argv.slice(2);
withGateQueue(Effect.gen(function*(){
  writeFileSync(marker, 'entered');
  while (!existsSync(marker+'.release')) yield* Effect.sleep('10 millis');
}), slot, {cpus:8, demand:demand === 'all' ? 'all' : 1}).pipe(effect => Effect.yieldNow.pipe(Effect.andThen(effect)), NodeRuntime.runMain);
`);
  const waitFile = (path: string) => Effect.gen(function*() {
    while (!(yield* fs.exists(path))) yield* Effect.sleep('10 millis');
  }).pipe(Effect.timeout('10 seconds'));
  const start = Effect.fn('test.gate.slots.start')(function*(name: string, demand: 'all' | 1 = 1) {
    const marker = join(root, name);
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [fixture, slot, marker, String(demand)], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    const queued = yield* Deferred.make<void>();
    let output = '';
    const drain = yield* Stream.runForEach(Stream.decodeText(child.all), chunk => Effect.gen(function*() {
      output += chunk;
      if (output.includes('# Gate queued:')) yield* Deferred.succeed(queued, undefined);
    })).pipe(Effect.forkScoped);
    return { child, marker, queued, finish: Effect.gen(function*() {
      const code = yield* child.exitCode;
      yield* Fiber.join(drain);
      assert.equal(Number(code), 0, output);
    }) };
  });
  const first = yield* start('first'), second = yield* start('second');
  yield* waitFile(first.marker);
  yield* waitFile(second.marker);
  const full = yield* start('full', 'all');
  yield* Deferred.await(full.queued).pipe(Effect.timeout('10 seconds'));
  const cancelled = yield* start('cancelled');
  yield* Deferred.await(cancelled.queued).pipe(Effect.timeout('10 seconds'));
  yield* cancelled.child.kill({ killSignal: 'SIGTERM' });
  yield* cancelled.child.exitCode.pipe(Effect.ignore);
  const state = JSON.parse(yield* fs.readFileString(join(slot, 'requests.json'))) as { requests: {pid: number}[] };
  assert.equal(state.requests.some(request => request.pid === Number(cancelled.child.pid)), false, 'cancellation removes the waiting claim before process exit');
  const late = yield* start('late');
  yield* Deferred.await(late.queued).pipe(Effect.timeout('10 seconds'));
  yield* fs.writeFileString(first.marker + '.release', 'release');
  yield* first.finish;
  assert.equal(yield* fs.exists(full.marker), false, 'full demand cannot hold a partial claim');
  assert.equal(yield* fs.exists(late.marker), false, 'later target cannot bypass an earlier full demand');
  yield* second.child.kill({ killSignal: 'SIGKILL' });
  yield* second.child.exitCode.pipe(Effect.ignore);
  yield* waitFile(full.marker);
  assert.equal(yield* fs.exists(late.marker), false, 'full gate owns every slot after the killed owner is reclaimed');
  yield* fs.writeFileString(full.marker + '.release', 'release');
  yield* full.finish;
  yield* waitFile(late.marker);
  yield* fs.writeFileString(late.marker + '.release', 'release');
  yield* late.finish;
  assert.deepEqual(JSON.parse(yield* fs.readFileString(join(slot, 'requests.json'))).requests, []);
})).pipe(Effect.provide(NodeServices.layer)), { signal: t.signal }));
