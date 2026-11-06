import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { auditTestLayers, classifyTestLayer, summarizeTestLayers } from '../../scripts/test-layers.js';

// @feature docs/engineering/testing/README.md#分层
test('test layers classify real boundary directories and reject support and unknown directories', () => Effect.runPromise(Effect.sync(() => {
  for (const layer of ['model', 'domain', 'cli', 'process', 'e2e'] as const) {
    assert.equal(classifyTestLayer(`test/${layer}/example.${layer === 'e2e' ? 'e2e' : 'test'}.ts`), layer);
    assert.equal(classifyTestLayer(`/repo/test/${layer}/nested/example.test.ts`, '/repo'), layer);
  }
  assert.equal(classifyTestLayer('test/architecture.test.ts'), 'model');
  for (const file of ['test/support/a.ts', 'test/fixtures/a.test.ts', 'test/unknown/a.test.ts', 'src/a.test.ts', 'test/model/a.ts', '../test/model/a.test.ts']) {
    assert.equal(classifyTestLayer(file), undefined, file);
  }
})));

// @feature docs/engineering/testing/README.md#分层
test('the complete inventory reports high-layer files without a file-ratio verdict', () => Effect.runPromise(Effect.sync(() => {
  const balanced = ['test/cli/a.test.ts', 'test/model/a.test.ts', 'test/domain/a.test.ts', 'test/e2e/a.e2e.ts'];
  assert.equal(auditTestLayers(balanced).reduce((sum, row) => sum + row.files, 0), 4);
  assert.deepEqual(auditTestLayers([...balanced, 'test/process/a.test.ts']).map(row => row.files), [1, 1, 1, 1, 1]);
  assert.deepEqual(auditTestLayers([]).map(row => row.files), [0, 0, 0, 0, 0]);
})));

// @feature docs/engineering/testing/README.md#分层
test('layer reports count selected files once, preserve missing timings and sum official durations', () => Effect.runPromise(Effect.sync(() => {
  assert.deepEqual(summarizeTestLayers([
    'test/model/a.test.ts', '/repo/test/model/a.test.ts', 'test/domain/a.test.ts', 'test/cli/a.test.ts', 'test/e2e/a.e2e.ts',
  ], [
    { file: 'test/model/a.test.ts', duration_ms: 2, cases: 99 }, { file: '/repo/test/model/a.test.ts', duration_ms: 5, cases: 3 },
    { file: 'test/domain/a.test.ts', duration_ms: 7 }, { file: 'test/cli/not-selected.test.ts', duration_ms: 100, cases: 99 },
  ], '/repo'), [
    { layer: 'model', files: 1, timedFiles: 1, cases: 3, countedFiles: 1, duration_ms: 5 },
    { layer: 'domain', files: 1, timedFiles: 1, cases: 0, countedFiles: 0, duration_ms: 7 },
    { layer: 'cli', files: 1, timedFiles: 0, cases: 0, countedFiles: 0, duration_ms: 0 },
    { layer: 'process', files: 0, timedFiles: 0, cases: 0, countedFiles: 0, duration_ms: 0 },
    { layer: 'e2e', files: 1, timedFiles: 0, cases: 0, countedFiles: 0, duration_ms: 0 },
  ]);
})));
