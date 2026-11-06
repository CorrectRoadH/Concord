// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from 'effect';
import { ProcessEvent, classifyConcordProcess } from '../../src/base/process/index.ts';
import { summarizeProcessEvents } from '../../scripts/process-events.ts';

const file = 'test/model/example.test.ts';
const event = (id: string, kind: ProcessEvent['kind'], extra: Partial<ProcessEvent> = {}): ProcessEvent => ({ id, run: 'run', file, pid: 100, ppid: 99, kind, ...extra });
const coverage = [event('start', 'coverage-start'), event('end', 'coverage-end', { healthy: true })];

// @feature docs/engineering/testing/README.md#成本与稳定
test('process events identify source and installed product roles without counting external processes', () => {
  for (const extension of ['ts', 'js']) {
    assert.equal(classifyConcordProcess(['node', `/pkg/entry/cli/entry.${extension}`, 'trace', 'show']), 'cli');
    assert.equal(classifyConcordProcess(['node', `/pkg/entry/cli/entry.${extension}`, 'server', 'run', '--root', '/repo']), 'service');
    assert.equal(classifyConcordProcess(['node', `/pkg/entry/server/compute-worker.${extension}`]), 'compute');
    assert.equal(classifyConcordProcess(['node', `/pkg/entry/server/operation/main.${extension}`]), 'operation');
    assert.equal(classifyConcordProcess(['node', `/pkg/entry/server/query-scan-worker.${extension}`]), 'worker');
  }
  assert.equal(classifyConcordProcess(['/pkg/bin/concord', '--help']), 'cli');
  for (const command of [['git', 'status'], ['node', '--test', file], ['playwright', 'test'], ['node', '/pkg/test/fixtures/probe.ts']]) assert.equal(classifyConcordProcess(command), undefined);
});

// @feature docs/engineering/testing/README.md#成本与稳定
test('report deduplicates events, excludes nested runs and keeps file associations', () => {
  const spawn = event('child:spawn', 'spawn', { role: 'cli', childPid: 101 });
  const report = summarizeProcessEvents([file], [...coverage, spawn, spawn, event('nested', 'spawn', { run: 'nested-run', role: 'cli' }), event('other-file', 'spawn', { file: 'test/process/other.test.ts', role: 'service' }), event('service-attempt', 'attempt', { role: 'service' }), event('service-ready', 'service-ready', { role: 'service' }), event('reuse', 'service-reuse', { role: 'service' })], 'run');
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.files[0]?.counts, { cli: 1, worker: 0, service: 0, compute: 0, operation: 0 });
  assert.deepEqual(report.files[0]?.services, { attempts: 1, ready: 1, reusedConnections: 1 });
  assert.equal(report.layers.find(layer => layer.layer === 'model')?.observed.cli, 1);
});

// @feature docs/engineering/testing/README.md#成本与稳定
test('missing, failed, uninstrumented and conflicting telemetry never becomes exact zero', () => {
  for (const events of [[], coverage.slice(0, 1), [...coverage, event('child-start', 'process-start', { pid: 101 })], [...coverage, event('unknown', 'unknown')], [...coverage, event('failed', 'coverage-end', { healthy: false })], [...coverage, event('same', 'spawn', { role: 'cli' }), event('same', 'spawn', { role: 'worker' })]]) {
    const report = summarizeProcessEvents([file], events, 'run');
    assert.equal(report.status, 'unknown');
    assert.equal(report.files[0]?.counts, null);
  }
  assert.equal(summarizeProcessEvents([file], coverage, 'run', true).files[0]?.services, null);
  assert.equal(summarizeProcessEvents([file], coverage, undefined).status, 'unknown');
});

// @feature docs/engineering/testing/README.md#成本与稳定
test('event boundary rejects unknown fields, invalid roles and malformed process identities', () => {
  const decode = Schema.decodeUnknownSync(ProcessEvent, { onExcessProperty: 'error' });
  assert.throws(() => decode({ ...event('one', 'spawn'), secret: 'not permitted' }));
  assert.throws(() => decode({ ...event('one', 'spawn'), role: 'git' }));
  assert.throws(() => decode({ ...event('one', 'spawn'), pid: '123' }));
});

// @feature docs/engineering/testing/README.md#成本与稳定
test('browser worker fixtures keep their real owner and contribute to e2e without inventing a case file', () => {
  const fixtureFile = 'test/e2e/engine.ts';
  const events = [...coverage, event('service', 'spawn', { role: 'service' })].map(event => ({ ...event, file: fixtureFile, scope: 'browser-worker' as const, workerID: 'run/web/1' }));
  const report = summarizeProcessEvents(['test/e2e/page.e2e.ts'], events, 'run');
  assert.equal(report.fixtures.length, 1);
  assert.equal(report.fixtures[0]?.file, fixtureFile);
  assert.equal(report.fixtures[0]?.workerID, 'run/web/1');
  assert.equal(report.fixtures[0]?.counts?.service, 1);
  assert.equal(report.files[0]?.counts, null);
  assert.equal(report.layers.find(layer => layer.layer === 'e2e')?.observed.service, 1);
  assert.equal(report.layers.find(layer => layer.layer === 'e2e')?.files, 1);
  assert.equal(report.layers.find(layer => layer.layer === 'e2e')?.fixtureWorkers, 1);
  assert.equal(report.status, 'unknown');
});
