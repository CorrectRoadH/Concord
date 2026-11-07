import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProfileEvidence } from '../../scripts/profile.ts';

const profile = JSON.stringify({
  nodes: [{ id: 1, callFrame: { functionName: 'scan', scriptId: '1', url: 'file:///install/app/dist/scan.js', lineNumber: 0, columnNumber: 0 } }],
  startTime: 0, endTime: 1000, samples: [1], timeDeltas: [1000],
});
const cpu = (pid: number) => `CPU.20261107.120000.${pid}.0.cpuprofile`;
const counter = (pid: number) => JSON.stringify({
  pid, ppid: 1, argv: ['scan'], exitCode: 0, wallMs: 1,
  userMs: 1, systemMs: 0, maxRssKiB: 100, fsRead: 0, fsWrite: 0,
  voluntaryContextSwitches: 0, involuntaryContextSwitches: 0, fs: {},
});
const completed = new Set(['counter-41.json']);

// @feature docs/engineering/performance/architecture.md
// @issue docs/issues/profile-warm-process-evidence.md
test('profile excludes completed warm counters and retains services that exit after the run', () => {
  const evidence = new Map([[cpu(41), profile], ['counter-41.json', counter(41)], [cpu(42), profile], ['counter-42.json', counter(42)], [cpu(43), profile], ['counter-43.json', counter(43)]]);
  const summary = summarizeProfileEvidence(evidence, completed);
  assert.deepEqual(summary.map(item => item.pid), [42, 43]);
  assert.equal(summary[0]!.totalMs, 1);
  assert.equal(evidence.size, 6);
});

// @feature docs/engineering/performance/architecture.md
// @issue docs/issues/profile-warm-process-evidence.md
test('completed warm evidence cannot replace missing actual measurement evidence', () => {
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(41), profile], ['counter-41.json', counter(41)]]), completed), /Missing profile evidence/u);
});

// @feature docs/engineering/performance/architecture.md
test('profile still rejects actual counters without CPU after excluding warm counters', () => {
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(41), profile], ['counter-41.json', counter(41)], ['counter-42.json', counter(42)]]), completed), /counter has no matching CPU/u);
});
