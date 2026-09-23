// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect } from 'effect';
import { makeOwnedProcessService } from '../src/owned-process.js';

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('owned process counts raw bytes and decodes UTF-8 across chunks', { skip: process.platform === 'win32' }, async () => {
  const service = makeOwnedProcessService();
  const split = await Effect.runPromise(Effect.scoped(service.run([process.execPath, '-e', "const b=Buffer.from('你好');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),10)"], { cwd: tmpdir(), outputLimitBytes: 6 })));
  assert.equal(split.stdout, '你好');
  assert.equal(split.outputBytes, 6);
  assert.equal(split.outputLimitExceeded, false);
  const capped = await Effect.runPromise(Effect.scoped(service.run([process.execPath, '-e', "process.stdout.write('你好')"], { cwd: tmpdir(), outputLimitBytes: 5 })));
  assert.equal(capped.outputLimitExceeded, true);
  assert.equal(capped.outputBytes, 5);
  assert.equal(capped.groupCleanup.gone, true);
});

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('owned process records confirmed cleanup after fiber cancellation', { skip: process.platform === 'win32' }, async () => {
  const service = makeOwnedProcessService();
  const controller = new AbortController();
  const running = Effect.runPromise(Effect.scoped(service.run([process.execPath, '-e', 'setInterval(()=>{},1000)'], { cwd: tmpdir() })), { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(running);
  const results = await Effect.runPromise(service.cleanupResults);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.cancelled, true);
  assert.equal(results[0]?.groupCleanup.gone, true);
  assert.equal(await Effect.runPromise(service.activeCount), 0);
});
