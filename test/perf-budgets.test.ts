import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { budgetSources, missingOwner, parseBudgetTable } from '../scripts/perf/budgets.js';
import { judge, median, summarize } from '../scripts/perf/stats.js';

// @feature docs/feature/local-sdlc/README.md
test('current budget owners contain nonempty tables and a two-minute refresh limit', () => Effect.runPromise(Effect.sync(() => {
  const root = resolve('.');
  assert.deepEqual(Object.keys(budgetSources).sort(), ['cli', 'query', 'refresh']);
  for (const [kind, source] of Object.entries(budgetSources)) {
    const rows = parseBudgetTable(readFileSync(join(root, source.path), 'utf8'), source.heading);
    assert.ok(rows.length > 0, `${kind} must contain budget rows`);
    for (const row of rows) {
      assert.ok(row.commands.length > 0, `${kind} must list commands`);
      assert.ok(Number.isInteger(row.limitMs) && row.limitMs > 0);
      for (const args of row.commands) assert.notEqual(args[0], 'concord');
      if (kind === 'refresh') assert.equal(row.limitMs, 120000);
    }
  }
})));

// @feature docs/feature/local-sdlc/README.md
test('budget table parsing selects the named section and preserves complete command arguments', () => Effect.runPromise(Effect.sync(() => {
  const markdown = [
    '## Other section',
    '| Commands | Budget |',
    '| --- | ---: |',
    '| `concord check` | 1ms |',
    '## Performance budget',
    'Introductory text.',
    '| Commands | Budget |',
    '| --- | ---: |',
    '| `concord --json --fresh --dry-run trace gaps`, `concord review render local-sdlc`, `warm` | 600ms |',
    '',
    '| Another table | Budget |',
    '| --- | ---: |',
    '| `concord check` | 2ms |',
    '## Next section',
    '| Commands | Budget |',
    '| --- | ---: |',
    '| `concord check` | 3ms |',
  ].join('\n');
  assert.deepEqual(parseBudgetTable(markdown, 'Performance budget'), [{
    commands: [['--json', '--fresh', '--dry-run', 'trace', 'gaps'], ['review', 'render', 'local-sdlc']],
    limitMs: 600,
  }]);
  assert.throws(() => parseBudgetTable(markdown, 'Absent section'));
  assert.throws(() => parseBudgetTable('## Empty section\nNo table.', 'Empty section'));
  assert.throws(() => parseBudgetTable('## Invalid section\n| Commands | Budget |\n| --- | ---: |\n| `warm` | 600ms |', 'Invalid section'));
})));

// @feature docs/feature/local-sdlc/README.md
test('the self consumer has every owner referenced by its budget commands', () => Effect.runPromise(Effect.sync(() => {
  const root = resolve('.');
  for (const source of Object.values(budgetSources)) {
    for (const row of parseBudgetTable(readFileSync(join(root, source.path), 'utf8'), source.heading)) {
      for (const args of row.commands) {
        assert.equal(missingOwner(args, path => existsSync(join(root, path))), undefined, `concord ${args.join(' ')}`);
      }
    }
  }
})));

// @feature docs/feature/local-sdlc/README.md
test('missing owner detection reports the first absent docs argument', () => Effect.runPromise(Effect.sync(() => {
  const first = 'docs/feature/first/README.md';
  const second = 'docs/feature/second/README.md';
  assert.match(missingOwner(['--json', 'trace', 'show', first, second], () => false) ?? '', /docs\/feature\/first\/README\.md/u);
  assert.match(missingOwner(['trace', 'show', first, second], path => path === first) ?? '', /docs\/feature\/second\/README\.md/u);
  assert.equal(missingOwner(['trace', 'show', first, second], () => true), undefined);
  assert.equal(missingOwner(['memory', 'recall', 'HawDB'], () => false), undefined);
})));

// @feature docs/feature/local-sdlc/README.md
test('trace show and review render resolve feature identifiers to owner paths', () => Effect.runPromise(Effect.sync(() => {
  for (const command of [['trace', 'show'], ['review', 'render']]) {
    const checked: string[] = [];
    const reason = missingOwner(['--json', '--fresh', '--dry-run', ...command, 'missing-feature'], path => {
      checked.push(path);
      return false;
    });
    assert.deepEqual(checked, ['docs/feature/missing-feature/README.md']);
    assert.match(reason ?? '', /docs\/feature\/missing-feature\/README\.md/u);
    assert.equal(missingOwner([...command, 'local-sdlc'], path => path === 'docs/feature/local-sdlc/README.md'), undefined);
    assert.equal(missingOwner([...command, 'docs/feature/local-sdlc/README.md'], path => path === 'docs/feature/local-sdlc/README.md'), undefined);
  }
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
test('samples above twice p50 invalidate candidate and baseline verdicts', () => Effect.runPromise(Effect.sync(() => {
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
