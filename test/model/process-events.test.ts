// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import assert from 'node:assert/strict';
import test from 'node:test';
import { channel } from 'node:diagnostics_channel';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ProcessEvent, classifyConcordProcess, observeProcessEvents, processEventEnvironment, recordProcessEvent, recordProcessSpawn } from '../../src/base/process/index.ts';
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

const recordedEvents = (fs: FileSystem.FileSystem, directory: string) => Effect.gen(function*() {
  const entries = yield* fs.readDirectory(directory);
  const records: ProcessEvent[] = [];
  for (const entry of entries) {
    const bytes = yield* fs.readFileString(join(directory, entry));
    for (const line of bytes.trim().split('\n')) records.push(Schema.decodeUnknownSync(Schema.fromJsonString(ProcessEvent), { onExcessProperty: 'error' })(line));
  }
  return records;
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('process attempts and events use only their explicit diagnostic environment', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-event-environment-' });
  const command = ['node', '/pkg/entry/cli/entry.ts', '--version'];
  const environment = Object.freeze({ CONCORD_TEST_EVENT_DIRECTORY: directory, CONCORD_TEST_RUN_ID: 'explicit-run', CONCORD_TEST_FILE_ID: file, SECRET: 'never persisted' });
  recordProcessEvent({ kind: 'unknown' });
  recordProcessEvent({ kind: 'unknown' }, {});
  recordProcessSpawn(command, {}, 123);
  assert.deepEqual(processEventEnvironment(command), {});
  assert.deepEqual(processEventEnvironment(command, {}), {});
  recordProcessEvent({ kind: 'unknown' }, { CONCORD_TEST_EVENT_DIRECTORY: directory });
  assert.deepEqual(yield* fs.readDirectory(directory), []);
  const child = processEventEnvironment(command, environment);
  assert.equal(environment.CONCORD_TEST_RUN_ID, 'explicit-run');
  assert.ok(!Object.hasOwn(environment, 'CONCORD_TEST_PROCESS_EVENT_ID'));
  recordProcessSpawn(command, child, 123);
  recordProcessEvent({ kind: 'service-ready', role: 'service' }, environment);
  const records = yield* recordedEvents(fs, directory);
  assert.deepEqual(records.map(record => record.kind), ['attempt', 'spawn', 'service-ready']);
  assert.ok(records.every(record => record.run === 'explicit-run' && record.file === file));
  assert.equal(records[0]?.id, `${child.CONCORD_TEST_PROCESS_EVENT_ID}:attempt`);
  assert.equal(records[1]?.id, `${child.CONCORD_TEST_PROCESS_EVENT_ID}:spawn`);
  assert.ok(!JSON.stringify(records).includes('never persisted'));
})).pipe(Effect.provide(NodeServices.layer))));

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('connection diagnostics route explicit environments once and release observer ownership', t => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-event-observers-' });
  const environment = Object.freeze({ CONCORD_TEST_EVENT_DIRECTORY: directory, CONCORD_TEST_RUN_ID: 'first', CONCORD_TEST_FILE_ID: file, OPTIONAL: undefined });
  const events = channel('concord.test.process-event');
  const wasObserved = events.hasSubscribers;
  const releaseFirst = observeProcessEvents(), releaseSecond = observeProcessEvents();
  t.after(releaseFirst);
  t.after(releaseSecond);
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment }))));
  releaseFirst(); releaseFirst();
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment: { ...environment, CONCORD_TEST_RUN_ID: 'second' } }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse' }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment: {} }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment: { CONCORD_TEST_EVENT_DIRECTORY: directory } }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment, unexpected: 'not permitted' }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'other', environment }))));
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment: { ...environment, invalid: 1 } }))));
  const records = yield* recordedEvents(fs, directory);
  assert.deepEqual(records.map(record => [record.kind, record.run]), [['service-reuse', 'first'], ['service-reuse', 'second'], ['unknown', 'first'], ['unknown', 'first']]);
  releaseSecond(); releaseSecond();
  assert.equal(events.hasSubscribers, wasObserved);
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment }))));
  assert.equal((yield* recordedEvents(fs, directory)).length, records.length + Number(wasObserved));
  const releaseAgain = observeProcessEvents();
  t.after(releaseAgain);
  (yield* Effect.tryPromise(async () => (await events.publish({ kind: 'service-reuse', environment }))));
  assert.equal((yield* recordedEvents(fs, directory)).length, records.length + Number(wasObserved) + 1);
  releaseAgain();
  assert.equal(events.hasSubscribers, wasObserved);
})).pipe(Effect.provide(NodeServices.layer))));
