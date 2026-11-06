import assert from 'node:assert/strict';
import test from 'node:test';
import { humanOutput } from '../../src/entry/cli/index.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @issue docs/issues/native-observation-human-output.md
test('human observations retain native case and dependency facts without case-marker placeholders', () => {
  const native = { nativeId: 'node:case-1', project: 'main', file: 'test/example.test.ts', kind: 'leaf', group: 'group-1', range: { startLine: 4, endLine: 9, sourceDigest: 'sha256:source' }, selection: { opaqueId: 'case-1', capabilityVersion: 'v1' }, tags: { owner: 'docs' }, provenance: 'node' };
  const dependency = { testId: 'case-1', scope: 'file', file: 'test/example.test.ts', declarations: ['code-1'], edges: [{ from: 'test/example.test.ts', to: 'src/example.ts' }], gaps: ['FileScope'] };
  for (const operation of ['test-discover', 'test-show', 'code-analyze']) {
    const output = humanOutput({ operation, observations: [{ value: { cases: [native], dependencies: [dependency] }, complete: true, gaps: [], current: true }] });
    assert.doesNotMatch(output, /undefined/u);
    for (const fact of ['node:case-1', 'main', 'test/example.test.ts', 'leaf', 'group-1', 'startLine: 4', 'endLine: 9', 'code-1', 'src/example.ts', 'FileScope']) assert.ok(output.includes(fact), fact);
  }
  const marker = humanOutput({ cases: [{ id: 'case-1', file: 'test/example.test.ts', line: 4, contract: 'docs/feature/example/README.md', status: 'declared' }] });
  assert.match(marker, /case-1 — test\/example.test.ts:4/u);
  assert.match(marker, /Contract: docs\/feature\/example\/README.md/u);
});
