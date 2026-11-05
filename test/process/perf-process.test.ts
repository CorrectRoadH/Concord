import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect, Fiber, FileSystem } from 'effect';
import { mustRun, timedRun } from '../../scripts/perf/process.js';
import { workDirectory } from '../../scripts/perf/workspace.js';

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
