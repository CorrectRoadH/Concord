import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { AnalysisViewSchema, TraceShowValue } from '../../src/model/index.ts';
import { hydrateQueryValue, renameUseCaseStep } from '../../src/app/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { query, analyze, projectCheck } from '../support/lsp-observation-operations.ts';
import { consumer, server, target, source, write } from '../support/lsp-analysis-source-fixture.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#inspect-associations
// @name analyzed-step-relevance
// Cross-Design acceptance: LSP C3 and journey C6 use the shared step owner through real source application views; installed command routing has its own process acceptance.
test('analyzed step references retain their level through code test and trace views', async () => {
  const root = consumer();
  try {
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...server(), budgets: { totalMs: 20_000, requestMs: 5000 } }] });
    const contract = readFileSync(join(root, target), 'utf8');
    write(root, target, `${contract}\n\n1. Observe the implementation. {#observe}\n`);
    write(root, 'src/sample.py', source.replace(target, `${target}#observe`));
    write(root, 'test/sample.py', `# @use-case ${target}#observe\n# @name native-sample\ndef test_sample():\n    helper()\n`);
    assert.equal((await query(root, { name: 'check', input: {} }, projectCheck)).ok, true);
    const observed = (await analyze(root)).observations;
    const id = observed.find(item => item.value.analyzer === 'python-fixture')!.value.dependencies[0]!.testId;
    for (const request of [{ name: 'code.list', input: {} }, { name: 'test.show', input: { id } }, { name: 'trace.show', input: { reference: target } }] as const) {
      const result = await query(root, request, Schema.Struct({ analysis: AnalysisViewSchema }));
      const relevance = result.analysis.relevance.find(item => item.testId === id)!.relevance;
      assert.equal(relevance.verdict, 'observed');
      if (relevance.verdict === 'observed') assert.equal(relevance.level, 'step');
      assert.ok(relevance.gaps.includes('FileScope'));
      assert.ok(relevance.gaps.includes('OpenWorldCalls'));
    }
    const traced = await query(root, { name: 'trace.show', input: { reference: target } }, TraceShowValue);
    assert.equal(traced.stepGroups[0]!.observation.result, 'observed');
    assert.equal(traced.stepGroups[0]!.steps[0]!.relevance[0]!.relevance.verdict, 'observed');
    const hydrated = hydrateQueryValue(root, traced).value;
    assert.equal(hydrated.operation, 'trace-show');
    if ('stepGroups' in hydrated) {
      assert.equal(hydrated.stepGroups[0]!.observation.result, 'not-observed');
      assert.deepEqual(hydrated.stepGroups[0]!.steps[0]!.relevance[0]!.relevance.gaps, ['SnapshotNotCurrent']);
    }
    const writer = new LocalRepository(root);
    try { renameUseCaseStep(writer, target, 'observe', '检查'); } finally { writer.close(); }
    assert.ok(readFileSync(join(root, 'src/sample.py'), 'utf8').includes(`${target}#检查`));
    assert.ok(readFileSync(join(root, 'test/sample.py'), 'utf8').includes(`${target}#检查`));
    assert.equal((await query(root, { name: 'check', input: {} }, projectCheck)).ok, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


