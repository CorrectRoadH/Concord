import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { summarizeBrowserAttempts } from '../../scripts/browser-test-report.ts';
import { BrowserAttemptTimer, readBrowserLifecycle, readBrowserSelection, readFileTimings, recordBrowserTiming, summarizeBrowserCosts, summarizeBrowserLifecycle, summarizeFileTimings, timingMeasurement, writeBrowserCostReport, writeTimingReport, type BrowserAttemptCost, type LifecycleTiming } from '../../scripts/gate-timings.ts';
import { summarizeMeasuredTestLayers } from '../../scripts/test-layers.ts';

// @feature docs/engineering/testing/README.md#成本与稳定
test('timing reports distinguish official elapsed, browser attempt sums and wallclock', () => Effect.runPromise(Effect.sync(() => {
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
  const layers = summarizeMeasuredTestLayers([...files, 'test/e2e/a.e2e.ts'], [...rows,
    { file: 'test/e2e/a.e2e.ts', duration_ms: 25, success: true, metric: 'browser-attempt-sum' },
  ], '/repo');
  assert.equal(layers[0]!.metric, 'node-file-elapsed-sum');
  assert.equal(layers[4]!.metric, 'browser-attempt-sum');
  assert.equal(layers[4]!.duration_ms, 25);
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('missing, failed, mismatched and untimed observations remain unknown rather than zero', () => Effect.runPromise(Effect.sync(() => {
  const file = 'test/model/a.test.ts';
  const failed = { file, duration_ms: 15, success: false };
  for (const result of [
    summarizeFileTimings([file], [], 'node-file-elapsed-sum'),
    summarizeFileTimings([file], [failed], 'node-file-elapsed-sum'),
    summarizeFileTimings([file], [{ ...failed, success: true }], 'node-file-elapsed-sum', false),
    summarizeFileTimings([file], [{ ...failed, success: true, metric: 'browser-attempt-sum' }], 'node-file-elapsed-sum'),
    summarizeFileTimings([file], [{ ...failed, success: true, unknownAttempts: 1 }], 'browser-attempt-sum'),
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
test('browser reports sum every selected attempt and retain selected cases with no attempt', () => Effect.runPromise(Effect.sync(() => {
  const result = { file: 'test/e2e/a.e2e.ts', selected: true, kind: 'test', status: 'passed' };
  const rows = summarizeBrowserAttempts([
    { ...result, attempts: [{ durationMs: 11 }, { durationMs: 13 }] },
    { ...result, attempts: [{ durationMs: 17 }] },
    { ...result, file: 'test/e2e/untimed.e2e.ts', status: 'skipped', attempts: [] },
    { ...result, selected: false, attempts: [{ durationMs: 1000 }] },
    { ...result, kind: 'setup', attempts: [{ durationMs: 1000 }] },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { file: result.file, duration_ms: 41, cases: 2, success: true, metric: 'browser-attempt-sum', unknownAttempts: 0 });
  assert.equal(rows[1]!.unknownAttempts, 1);
  assert.equal(summarizeFileTimings(rows.map(row => row.file), rows, 'browser-attempt-sum').state, 'unknown');
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('lifecycle receipts survive startup, preserve original failures and identify the worker for sampling', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped();
  const previous = process.env.CONCORD_E2E_OUTPUT;
  const failure = new DOMException('cancelled fixture', 'AbortError');
  try {
    process.env.CONCORD_E2E_OUTPUT = output;
    const value = yield* Effect.promise(() => recordBrowserTiming('worker-start', async () => {
      const started = await Effect.runPromise(readBrowserLifecycle(output).pipe(Effect.provide(NodeServices.layer)));
      assert.equal(started.length, 1);
      assert.equal(started[0]!.state, 'started');
      assert.equal(started[0]!.endedAt, null);
      return 'ready';
    }, 'run/chromium/0'));
    assert.equal(value, 'ready');
    yield* Effect.promise(() => assert.rejects(recordBrowserTiming('fixture-start', () => Promise.reject(failure), 'run/chromium/0'), cause => cause === failure));
    const rows = yield* readBrowserLifecycle(output);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.pid, process.pid);
      assert.equal(row.workerID, 'run/chromium/0');
      assert.equal(row.state, 'finished');
      assert.ok(row.startedAt > 0 && row.endedAt! >= row.startedAt);
      assert.ok(row.duration_ms >= 0);
    }
    const totals = summarizeBrowserLifecycle(rows, true);
    assert.equal(totals.find(row => row.phase === 'worker-start')!.state, 'known');
    assert.equal(totals.find(row => row.phase === 'fixture-start')!.state, 'unknown');
    assert.equal(totals.find(row => row.phase === 'worker-stop')!.state, 'unknown');
    assert.ok(summarizeBrowserLifecycle([], true).every(row => row.state === 'unknown'));
    assert.ok(summarizeBrowserLifecycle([], false).every(row => row.state === 'not-selected'));
    const blocked = join(output, 'ordinary-file');
    yield* fs.writeFileString(blocked, 'not a directory');
    process.env.CONCORD_E2E_OUTPUT = blocked;
    assert.equal(yield* Effect.promise(() => recordBrowserTiming('worker-start', () => Promise.resolve(42))), 42);
    yield* Effect.promise(() => assert.rejects(recordBrowserTiming('worker-stop', () => Promise.reject(failure)), cause => cause === failure));
  } finally {
    if (previous === undefined) delete process.env.CONCORD_E2E_OUTPUT;
    else process.env.CONCORD_E2E_OUTPUT = previous;
  }
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/README.md#成本与稳定
test('browser leases pair by canonical worker identity across sibling pids and slot replacements', () => Effect.runPromise(Effect.sync(() => {
  const receipt = (id: string, phase: LifecycleTiming['phase'], pid: number): LifecycleTiming => ({
    id, phase, pid, worker: pid, workerID: 'run/chromium/0', startedAt: 100, endedAt: 110,
    state: 'finished', duration_ms: 10, success: true,
  });
  const rows = [receipt('a', 'browser-start', 101), receipt('b', 'browser-stop', 102),
    receipt('c', 'browser-start', 101), receipt('d', 'browser-stop', 103)];
  const totals = summarizeBrowserLifecycle(rows, true);
  for (const phase of ['browser-start', 'browser-stop']) {
    const total = totals.find(row => row.phase === phase)!;
    assert.equal(total.state, 'known');
    assert.equal(total.expected, 2);
    assert.equal(total.measured, 2);
    assert.equal(total.duration_ms, 20);
  }
  const pending = { ...receipt('e', 'browser-start', 101), state: 'started' as const, endedAt: null };
  const partial = summarizeBrowserLifecycle([...rows, pending], true);
  assert.equal(partial.find(row => row.phase === 'browser-start')!.state, 'unknown');
  assert.equal(partial.find(row => row.phase === 'browser-stop')!.state, 'unknown');
  const mismatched = rows.map(row => row.id === 'd' ? { ...row, workerID: 'run/chromium/1' } : row);
  assert.equal(summarizeBrowserLifecycle(mismatched, true).find(row => row.phase === 'browser-stop')!.state, 'unknown');
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('timing readers strictly decode reports and preserve missing or invalid telemetry as unknown', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped();
  const path = join(output, 'file-timings.json');
  assert.deepEqual(yield* readFileTimings(path), []);
  assert.equal(yield* readBrowserSelection(output), null);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: 9, success: true }]);
  assert.equal((yield* readFileTimings(path))[0]!.duration_ms, 9);
  yield* writeTimingReport(output, 'selected-files.json', ['test/e2e/a.e2e.ts']);
  assert.deepEqual(yield* readBrowserSelection(output), ['test/e2e/a.e2e.ts']);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: -9, success: true }]);
  assert.deepEqual(yield* readFileTimings(path), []);
  yield* writeTimingReport(output, 'file-timings.json', [{ file: 'test/model/a.test.ts', duration_ms: 9, success: true, unexpected: true }]);
  assert.deepEqual(yield* readFileTimings(path), []);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/README.md#成本与稳定
test('browser costs join exact attempt identities and never turn missing or failed stages into zero', () => Effect.runPromise(Effect.sync(() => {
  const result = { testId: 'real-test', titlePath: ['real title'], file: 'test/e2e/real.e2e.ts', kind: 'test', selected: true, status: 'passed', attempts: [{ id: 'actual-attempt', durationMs: 100, status: 'passed' }] };
  const receipt: BrowserAttemptCost = { attemptId: 'actual-attempt', artifactsDir: '/artifacts', pid: 123, workerID: 'worker', state: 'finished', spans: [
    { phase: 'frozen-files', started_ms: 0, ended_ms: 8, success: true },
    { phase: 'case-execution', started_ms: 10, ended_ms: 90, success: true },
    { phase: 'setup-refresh', started_ms: 20, ended_ms: 30, success: true },
    { phase: 'setup-refresh', started_ms: 40, ended_ms: 55, success: true },
  ] };
  const [row] = summarizeBrowserCosts([result], [receipt]);
  assert.equal(row!.testId, result.testId);
  assert.deepEqual(row!.titlePath, result.titlePath);
  assert.equal(row!.file, result.file);
  assert.equal(row!.phases.find(phase => phase.phase === 'frozen-files')!.duration_ms, 8);
  assert.equal(row!.phases.find(phase => phase.phase === 'setup-refresh')!.duration_ms, 25);
  assert.equal(row!.phases.find(phase => phase.phase === 'case-execution')!.duration_ms, 80);
  assert.equal(row!.executionExclusive.duration_ms, 55);
  assert.equal(row!.phases.find(phase => phase.phase === 'private-server-start')!.state, 'not-selected');
  assert.equal(row!.phases.find(phase => phase.phase === 'restore-refresh')!.state, 'unknown');
  for (const receipts of [[], [{ ...receipt, attemptId: 'different-attempt' }], [receipt, receipt], [{ ...receipt, state: 'started' as const }]]) {
    assert.ok(summarizeBrowserCosts([result], receipts)[0]!.phases.every(phase => phase.state === 'unknown'));
  }
  const failed = { ...result, attempts: [{ ...result.attempts[0]!, status: 'failed' }] };
  const failedRow = summarizeBrowserCosts([failed], [receipt])[0]!;
  assert.equal(failedRow.attempt.state, 'unknown');
  assert.equal(failedRow.phases[0]!.observed_duration_ms, 8);
  assert.ok(failedRow.phases.every(phase => phase.state === 'unknown'));
  assert.equal(summarizeBrowserCosts([{ ...result, attempts: [] }], [receipt])[0]!.attemptId, null);
})));

// @feature docs/engineering/testing/README.md#成本与稳定
test('browser cost receipts retain original failures and generate case reports from official IDs', () => Effect.runPromise(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped();
  const previous = process.env.CONCORD_E2E_OUTPUT;
  try {
    process.env.CONCORD_E2E_OUTPUT = output;
    const timer = new BrowserAttemptTimer('attempt-1', '/artifacts', 'worker');
    yield* Effect.promise(() => timer.persist());
    const failure = new Error('original operation failure');
    yield* Effect.promise(() => assert.rejects(timer.measure('restore-refresh', () => Promise.reject(failure)), cause => cause === failure));
    assert.throws(() => timer.sync('frozen-files', () => { throw failure; }), cause => cause === failure);
    yield* Effect.promise(() => timer.persist(true));
    yield* writeTimingReport(output, 'report.json', { schemaVersion: 'report-1', run: { results: [{
      testId: 'test-1', titlePath: ['actual title'], file: 'actual.e2e.ts', kind: 'test', selected: true, status: 'failed',
      attempts: [{ id: 'attempt-1', durationMs: 20, status: 'failed', steps: [] }],
    }] } });
    yield* writeBrowserCostReport(output);
    const report = yield* fs.readFileString(join(output, 'browser-costs.json'));
    assert.match(report, /"testId": "test-1"/u);
    assert.match(report, /"titlePath": \[\s*"actual title"/u);
    assert.match(report, /"attemptId": "attempt-1"/u);
    assert.ok(timer.receipt.spans.every(span => span.ended_ms !== null && !span.success));
    yield* fs.remove(join(output, 'report.json'));
    yield* writeBrowserCostReport(output);
    assert.match(yield* fs.readFileString(join(output, 'browser-costs.json')), /"state": "unknown"/u);
    const blocked = join(output, 'ordinary-file');
    yield* fs.writeFileString(blocked, 'not a directory');
    process.env.CONCORD_E2E_OUTPUT = blocked;
    yield* Effect.promise(() => timer.persist());
    yield* Effect.promise(() => assert.rejects(timer.measure('engine-start', () => Promise.reject(failure)), cause => cause === failure));
  } finally {
    if (previous === undefined) delete process.env.CONCORD_E2E_OUTPUT;
    else process.env.CONCORD_E2E_OUTPUT = previous;
  }
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))));
