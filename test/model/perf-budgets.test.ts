import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { WorkspaceResponse } from '../../bench/fixtures/view.js';
import { loadBudgets, missingOwner, parseBudgetTable } from '../../scripts/perf/budgets.js';
import { judge, median, summarize } from '../../scripts/perf/stats.js';

// @feature docs/feature/local-sdlc/README.md
test('budget discovery scans Feature owners and preserves scenario identities', () => Effect.runPromise(Effect.gen(function*() {
  const rows = yield* loadBudgets(resolve("."));
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.owner.startsWith('docs/feature/') && row.scenarios.length > 0));
  const refresh = rows.filter(row => row.heading === '刷新上限');
  assert.ok(refresh.some(row => row.scenarios.includes('herdr-mod/push')));
  for (const row of refresh) {
    const declared = parseBudgetTable(readFileSync(join(resolve('.'), row.owner), 'utf8'), row.heading);
    assert.ok(declared.some(value => value.limitMs === row.limitMs && value.scenarios.some(id => row.scenarios.includes(id))));
  }
  assert.deepEqual(parseBudgetTable('## 性能预算\n| 场景 | 内容 | p50 |\n| --- | --- | ---: |\n| `local-sdlc/help`、`local-sdlc/skill` | 启动 | 350ms |', '性能预算'), [{ scenarios: ['local-sdlc/help', 'local-sdlc/skill'], limitMs: 350 }]);
  for (const text of ['## 性能预算\nNo table.', '## 性能预算\n| 场景 | p50 |\n| --- | ---: |\n| `concord check` | 1ms |', '## 性能预算\n| 场景 | p50 |\n| --- | ---: |\n| `local-sdlc/help` | 0ms |']) assert.throws(() => parseBudgetTable(text, '性能预算'));
})));

// @feature docs/feature/local-sdlc/README.md
test('missing command owners are detected for paths and Feature identifiers', () => Effect.runPromise(Effect.sync(() => {
  assert.match(missingOwner(['trace', 'show', 'absent'], () => false) ?? '', /docs\/feature\/absent\/README.md/u);
  assert.match(missingOwner(['review', 'docs/feature/absent/README.md'], () => false) ?? '', /Missing owner/u);
  assert.match(missingOwner(['review', 'absent'], () => false) ?? '', /docs\/feature\/absent\/README.md/u);
  assert.equal(missingOwner(['memory', 'search', 'HawDB'], () => false), undefined);
})));

// @feature docs/feature/local-sdlc/README.md
test('median handles unsorted odd and even samples without mutating input', () => Effect.runPromise(Effect.sync(() => {
  const odd = [30, 10, 20];
  const even = [40, 10, 30, 20];
  assert.equal(median(odd), 20);
  assert.equal(median(even), 25);
  assert.deepEqual(odd, [30, 10, 20]);
  assert.deepEqual(even, [40, 10, 30, 20]);
})));

// @feature docs/feature/local-sdlc/README.md
test('samples above twice p50 and at least twenty milliseconds above it invalidate candidate and baseline verdicts', () => Effect.runPromise(Effect.sync(() => {
  const samples = [100, 201, 100];
  const candidate = summarize(samples);
  assert.deepEqual(candidate, { samples, p50: 100, max: 201, valid: false });
  const invalidCandidate = judge({ command: 'concord check', candidate, reference: false });
  assert.equal(invalidCandidate.pass, false);
  assert.ok(invalidCandidate.reasons.length > 0);
  const boundary = summarize([100, 200, 100]);
  assert.equal(boundary.valid, true);
  const valid = judge({ command: 'concord check', candidate: boundary, reference: false });
  assert.equal(valid.pass, true);
  assert.deepEqual(valid.reasons, []);
  const invalidBaseline = judge({ command: 'concord check', candidate: boundary, baseline: candidate, reference: false });
  assert.equal(invalidBaseline.pass, false);
  assert.ok(invalidBaseline.reasons.length > 0);
})));

// @feature docs/feature/local-sdlc/README.md
test('millisecond jitter stays valid while larger outliers and the twenty millisecond boundary fail', () => Effect.runPromise(Effect.sync(() => {
  assert.deepEqual(summarize([3, 3, 19]), { samples: [3, 3, 19], p50: 3, max: 19, valid: true });
  assert.equal(judge({ command: 'millisecond-response', candidate: summarize([3, 3, 19]), reference: false }).pass, true);
  assert.equal(summarize([100, 100, 250]).valid, false);
  assert.equal(summarize([3, 3, 23]).valid, false, 'a twenty millisecond excess is inclusive');
  assert.equal(summarize([3, 3, 22.999]).valid, true);
})));

// @feature docs/feature/local-sdlc/README.md
test('p50 regression fails at twenty-five percent and passes at fifteen and twenty percent', () => Effect.runPromise(Effect.sync(() => {
  const baseline = summarize([100, 100, 100]);
  for (const [p50, pass] of [[125, false], [115, true], [120, true]] as const) {
    const verdict = judge({ command: 'concord check', candidate: summarize([p50, p50, p50]), baseline, reference: false });
    assert.equal(verdict.pass, pass);
    assert.equal(verdict.regression, Math.round((p50 / baseline.p50 - 1) * 100) / 100);
    assert.equal(verdict.reasons.length === 0, pass);
  }
})));

// @feature docs/feature/local-sdlc/README.md
test('absolute p50 budgets are enforced only in the reference environment', () => Effect.runPromise(Effect.sync(() => {
  const input = { command: 'concord check', candidate: summarize([125, 125, 125]), limitMs: 100, limitKind: 'p50' as const };
  const otherMachine = judge({ ...input, reference: false });
  assert.equal(otherMachine.withinLimit, false);
  assert.equal(otherMachine.pass, true);
  assert.deepEqual(otherMachine.reasons, []);
  const reference = judge({ ...input, reference: true });
  assert.equal(reference.pass, false);
  assert.ok(reference.reasons.length > 0);
  const boundary = judge({ ...input, candidate: summarize([100, 100, 100]), reference: true });
  assert.equal(boundary.withinLimit, true);
  assert.equal(boundary.pass, true);
})));

// @feature docs/feature/local-sdlc/README.md
test('maximum process limits fail on every machine even when p50 is within budget', () => Effect.runPromise(Effect.sync(() => {
  const input = { command: 'concord --json --fresh --dry-run trace gaps', candidate: summarize([70, 70, 101]), limitMs: 100, limitKind: 'max' as const };
  assert.equal(input.candidate.valid, true);
  for (const reference of [false, true]) {
    const verdict = judge({ ...input, reference });
    assert.equal(verdict.withinLimit, false);
    assert.equal(verdict.pass, false);
    assert.ok(verdict.reasons.length > 0);
  }
  const boundary = judge({ ...input, candidate: summarize([70, 70, 100]), reference: false });
  assert.equal(boundary.withinLimit, true);
  assert.equal(boundary.pass, true);
})));

// @feature docs/feature/local-sdlc/README.md
test('budget discovery ignores fenced examples and rejects duplicate headings', () => Effect.runPromise(Effect.sync(() => {
  const example = '```markdown\n## 性能预算\n| 场景 | p50 |\n| --- | ---: |\n| `wrong/example` | 1ms |\n```\n';
  const table = '## 性能预算\n| 场景 | p50 |\n| --- | ---: |\n| `local-sdlc/help` | 350ms |';
  assert.deepEqual(parseBudgetTable(example + table, '性能预算'), [{ scenarios: ['local-sdlc/help'], limitMs: 350 }]);
  assert.throws(() => parseBudgetTable(`${table}\n${table}`, '性能预算'));
  assert.throws(() => parseBudgetTable(table.replace('350ms', '999999999999999999999ms'), '性能预算'));
})));

const decode = Schema.decodeUnknownSync(WorkspaceResponse, { onExcessProperty: 'error' });
const response = { ok: true, value: { snapshot: {}, projection: {
  sourceDigest: 'sha256:fixture', status: 'ready', current: false, refreshOwner: 'active',
  builtAt: '2026-10-31T00:00:00.000Z', builtFrom: '2026-10-31T00:00:00.000Z', builtUntil: '2026-10-31T00:00:00.000Z',
  complete: true, changedPaths: [], unknownRelations: false,
} } };

// @feature docs/feature/web-workbench/README.md
test('performance workspace response requires the current source identity and rejects retired consistency fields', () => {
  assert.equal(decode(response).value.projection.sourceDigest, 'sha256:fixture');
  const { sourceDigest: _sourceDigest, ...missingIdentity } = response.value.projection;
  assert.throws(() => decode({ ...response, value: { ...response.value, projection: missingIdentity } }));
  assert.throws(() => decode({ ...response, value: { ...response.value, projection: { ...response.value.projection, consistent: true } } }));
});
