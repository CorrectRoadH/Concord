import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeProfileEvidence } from '../../scripts/profile.ts';

const profile = JSON.stringify({
  nodes: [{ id: 1, callFrame: { functionName: 'scan', scriptId: '1', url: 'file:///install/app/dist/scan.js', lineNumber: 0, columnNumber: 0 } }],
  startTime: 0, endTime: 1000, samples: [1], timeDeltas: [1000],
});
const counter = JSON.stringify({
  pid: 42, ppid: 1, argv: ['--concord-internal', 'query-scan-worker'], exitCode: 0, wallMs: 1,
  userMs: 1, systemMs: 0, maxRssKiB: 100, fsRead: 0, fsWrite: 0,
  voluntaryContextSwitches: 0, involuntaryContextSwitches: 0, fs: { readFileSync: { count: 1, ms: 0.1 } },
});
const cpu = (pid: number, thread = 0) => `CPU.20261107.120000.${pid}.${thread}.cpuprofile`;

// @feature docs/engineering/performance/architecture.md
// @issue docs/issues/profile-private-install-evidence.md
test('profile summary includes sampled processes and excludes preparation and cleanup CPU files', () => {
  const summary = summarizeProfileEvidence(new Map([[cpu(41), profile], [cpu(42), profile], [cpu(42, 1), profile], [cpu(43), profile], ['counter-42.json', counter]]));
  assert.deepEqual(summary.map(item => item.pid), [42]);
  assert.equal(summary[0]!.totalMs, 2);
  assert.equal(summary[0]!.resources.fs.readFileSync!.count, 1);
});

// @feature docs/engineering/performance/architecture.md
test('profile summary rejects missing measurement evidence and unpaired sampled counters', () => {
  assert.throws(() => summarizeProfileEvidence(new Map()), /Missing profile evidence/u);
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(41), profile]])), /Missing profile evidence/u);
  assert.throws(() => summarizeProfileEvidence(new Map([['counter-42.json', counter]])), /Missing profile evidence/u);
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(41), profile], ['counter-42.json', counter]])), /counter has no matching CPU/u);
});

// @feature docs/engineering/performance/architecture.md
test('profile summary strictly decodes sampled CPU profiles and counters', () => {
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(42), '{"nodes":[]}'], ['counter-42.json', counter]])));
  assert.throws(() => summarizeProfileEvidence(new Map([[cpu(42), profile], ['counter-42.json', counter.replace('"pid":42', '"pid":"42"')]])));
  assert.throws(() => summarizeProfileEvidence(new Map([['unexpected.cpuprofile', profile], ['counter-42.json', counter]])), /Unexpected CPU profile name/u);
});
