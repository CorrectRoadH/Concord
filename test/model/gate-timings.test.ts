import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { readFileTimings, summarizeFileTimings, timingMeasurement, writeTimingReport } from '../../scripts/gate-timings.ts';
import { summarizeMeasuredTestLayers } from '../../scripts/test-layers.ts';

// @feature docs/engineering/testing/README.md#成本与稳定
test('timing reports distinguish official file elapsed and wallclock', () => Effect.runPromise(Effect.sync(() => {
  const files = ['test/model/a.test.ts', 'test/model/b.test.ts'];
  const rows = [
    { file: files[0]!, duration_ms: 50, success: true },
    { file: '/repo/test/model/a.test.ts', duration_ms: 70, success: true },
    { file: files[1]!, duration_ms: 40, success: true },
    { file: 'test/model/not-selected.test.ts', duration_ms: 9000, success: true },
  ];
  const measured = summarizeFileTimings([...files, files[0]!], rows, 'node-file-elapsed-sum', true, '/repo');
  assert.equal(measured.duration_ms, 110);
  assert.equal(measured.metric, 'node-file-elapsed-sum');
  assert.equal(measured.expected, 2);
  assert.equal(measured.measured, 2);
  const wallclock = timingMeasurement('gate-body-wallclock', [{ duration_ms: 80, success: true }], 1);
  assert.equal(wallclock.duration_ms, 80);
  assert.notEqual(wallclock.duration_ms, measured.duration_ms);
  const layers = summarizeMeasuredTestLayers(files, rows, '/repo');
  assert.equal(layers[0]!.metric, 'node-file-elapsed-sum');
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('missing, failed, mismatched and untimed observations remain unknown rather than zero', () => Effect.runPromise(Effect.sync(() => {
  const file = 'test/model/a.test.ts';
  const failed = { file, duration_ms: 15, success: false };
  for (const result of [
    summarizeFileTimings([file], [], 'node-file-elapsed-sum'),
    summarizeFileTimings([file], [failed], 'node-file-elapsed-sum'),
    summarizeFileTimings([file], [{ ...failed, success: true }], 'node-file-elapsed-sum', false),
    timingMeasurement('suite-wallclock', [], 1),
  ]) {
    assert.equal(result.state, 'unknown');
    assert.equal(result.duration_ms, null);
  }
  const partial = summarizeFileTimings([file], [failed], 'node-file-elapsed-sum');
  assert.equal(partial.observed_duration_ms, 15);
  assert.equal(timingMeasurement('suite-wallclock', [], 0).state, 'not-selected');
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('timing readers strictly decode reports and preserve missing or invalid telemetry as unknown', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped();
  const path = join(output, 'file-timings.json');
  assert.deepEqual(yield* readFileTimings(path), []);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: 9, success: true }]);
  assert.equal((yield* readFileTimings(path))[0]!.duration_ms, 9);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: -9, success: true }]);
  assert.deepEqual(yield* readFileTimings(path), []);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: 9, success: true, unexpected: true }]);
  assert.deepEqual(yield* readFileTimings(path), []);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
