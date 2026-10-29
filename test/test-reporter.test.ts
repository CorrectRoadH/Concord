import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { TestCounts } from '../scripts/test-reporter.js';

test('reporter retains circular failure diagnostics and reaches the final test summary', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-reporter-'));
  try {
    const summary = join(root, 'summary.json'), failures = join(root, 'failures.jsonl');
    const file = resolve('test/fixtures/reporter-circular-error.ts');
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-isolation=none',
      '--test-reporter=./scripts/test-reporter.ts', file], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, CONCORD_TEST_FILE: file, CONCORD_TEST_SUMMARY: summary,
        CONCORD_TEST_FAILURES: failures, CONCORD_TEST_TIMINGS: join(root, 'timings.jsonl') },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.doesNotMatch(result.stderr, /Converting circular structure|uncaughtException/u);
    assert.match(result.stdout, /not ok 1 - intentional circular error fixture/u);
    const counts = Schema.decodeUnknownSync(Schema.fromJsonString(TestCounts), { onExcessProperty: 'error' })(readFileSync(summary, 'utf8'));
    assert.equal(counts.tests, 1);
    assert.equal(counts.failed, 1);
    assert.equal(counts.cancelled, 0);
    const diagnostic = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String, error: Schema.String })))(readFileSync(failures, 'utf8').trim());
    assert.match(diagnostic.error, /intentional circular reporter failure/u);
    assert.match(diagnostic.error, /Circular/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
