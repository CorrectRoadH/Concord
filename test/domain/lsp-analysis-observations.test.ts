import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { clearWorkspaceCache } from '../../src/app/index.ts';
import { AnalysisObservationSchema, AnalysisViewSchema, CodeDeclarationSchema, type language_server_config_LanguageServer as LanguageServer } from '../../src/model/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { query, analyze, codeList, projectCheck } from '../support/lsp-observation-operations.ts';
import { consumer, server, target, write } from '../support/lsp-analysis-source-fixture.ts';

async function prepareCache(root: string): Promise<void> {
  const repo = await LocalRepository.open(root);
  try { PersistentCache.repository(repo).prepareWrite({ create: true }); } finally { repo.close(); }
}

// These cases validate relevance and invalidation, rather than timeout budgets.
// Dedicated budget tests retain the short fake-server limits and their failure assertions.
const semanticServer = (): LanguageServer => ({ ...server(), budgets: { totalMs: 20_000, requestMs: 5000 } });

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @issue docs/issues/test-architecture-gaps.md
// CASES lsp-integration C1-C5, C10, C12-C16, C18; test-journey-steps C6-C8, C13.
test('LSP observations retain marker identity, traverse test helpers, and never govern check', async () => {
  const root = (await consumer());
  try {
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [semanticServer()] });
    await prepareCache(root);
    const baseline = await query(root, { name: 'check', input: {} }, projectCheck); assert.equal(baseline.ok, true);
    const before = await query(root, { name: 'code.list', input: {} }, codeList);
    assert.equal(before.codes.length, 1); assert.equal(before.analysis.relevance[0]?.relevance.verdict, 'not-observed');
    const observed = (await analyze(root)).observations;
    const lsp = observed.find(value => value.value.analyzer === 'python-fixture')!;
    assert.equal(lsp.current, true); assert.equal(lsp.complete, false); assert.ok(lsp.gaps.includes('OpenWorldCalls'));
    assert.ok(lsp.gaps.includes('UnverifiedEnvironment'));
    assert.equal(lsp.value.locators[0]?.locator.name, 'implementation');
    assert.equal(lsp.value.locators[0]?.locator.range.start.line, 2);
    assert.ok(lsp.value.dependencies[0]?.edges.some(edge => edge.from === 'test/helper.py' && edge.to === 'src/sample.py'));
    const listed = await query(root, { name: 'code.list', input: {} }, codeList);
    assert.deepEqual(listed.codes, before.codes);
    assert.equal(listed.analysis.relevance[0]?.relevance.verdict, 'observed');
    assert.ok(listed.analysis.relevance[0]?.relevance.gaps.includes('UnverifiedEnvironment'));
    assert.ok(listed.analysis.relevance[0]?.relevance.gaps.includes('FileScope'));
    const id = lsp.value.dependencies[0]!.testId;
    const externalEnvironment = await query(root, { name: 'code.list', input: {} }, codeList, 0, 'concord-external-environment-change');
    assert.equal(externalEnvironment.analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, true);
    const shown = await query(root, { name: 'test.show', input: { id } }, Schema.Struct({ analysis: AnalysisViewSchema }));
    assert.equal(shown.analysis.relevance[0]?.relevance.verdict, 'observed');
    const traced = await query(root, { name: 'trace.show', input: { reference: 'docs/feature/sample/README.md' } }, Schema.Struct({ analysis: AnalysisViewSchema }));
    assert.equal(traced.analysis.relevance[0]?.relevance.verdict, 'observed');
    assert.deepEqual(await query(root, { name: 'check', input: {} }, projectCheck), baseline);
    const implementation = readFileSync(join(root, 'server.mjs'), 'utf8');
    write(root, 'server.mjs', implementation + '\n// implementation changed\n');
    assert.equal((await query(root, { name: 'code.list', input: {} }, codeList)).analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, false);
    write(root, 'server.mjs', implementation);
    write(root, 'src/new-member.py', 'def new_member():\n    pass\n');
    assert.equal((await query(root, { name: 'code.list', input: {} }, codeList)).analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, false);
    rmSync(join(root, 'src/new-member.py'));
    write(root, 'test/helper.py', 'def helper():\n    return 2\n');
    const stale = await query(root, { name: 'code.list', input: {} }, codeList);
    assert.equal(stale.analysis.observations[1]?.current, false);
    assert.equal(stale.analysis.relevance[0]?.relevance.verdict, 'not-observed');
    assert.deepEqual(await query(root, { name: 'check', input: {} }, projectCheck), baseline);
    write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
    const repeat = (await analyze(root)).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.deepEqual(repeat.value, lsp.value); assert.equal(repeat.inputs, lsp.inputs);
    const cacheRepo = (await LocalRepository.open(root));
    try { cacheRepo.snapshot(() => {
      const database = PersistentCache.repository(cacheRepo);
      const rows = database!.scan('code_cache');
      database!.put('code_cache', rows.map(row => ({ key: row.key, payload: '{damaged' })));
    }); } finally { cacheRepo.close(); }
    assert.deepEqual(await query(root, { name: 'check', input: {} }, projectCheck), baseline);
    await assert.rejects(query(root, { name: 'code.list', input: {} }, codeList));
    await runApplication(clearWorkspaceCache(root));
    await prepareCache(root);
    const shallow = semanticServer(); writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [{ ...shallow, budgets: { ...shallow.budgets, depth: 1 } }] });
    const limited = (await analyze(root)).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.ok(limited.gaps.includes('DepthLimit')); assert.deepEqual(limited.value.dependencies[0]?.declarations, []);
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [semanticServer()] });
    await runApplication(clearWorkspaceCache(root));
    await prepareCache(root);
    assert.deepEqual(await query(root, { name: 'check', input: {} }, projectCheck), baseline);
    assert.deepEqual((await query(root, { name: 'code.list', input: {} }, codeList)).codes, before.codes);
    assert.equal((await query(root, { name: 'code.list', input: {} }, codeList)).analysis.relevance[0]?.relevance.verdict, 'not-observed');
    const rebuilt = (await analyze(root)).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.deepEqual(rebuilt.value, lsp.value);
    // A broken marker still fails when an earlier good observation exists.
    write(root, 'src/sample.py', '# @concord-code\ndef implementation():\n    return 1\n');
    const invalid = await query(root, { name: 'check', input: {} }, projectCheck, 1); assert.equal(invalid.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES test-journey-steps C6-C8; lsp-integration C4, C13, C14, C18.
test('TypeScript imports and reexports provide only file-scoped relevance with boundary gaps', async () => {
  const root = (await consumer());
  try {
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [] });
    write(root, 'src/sample.ts', `// @concord-code\n// @concord-implements ${target}\nexport function implementation() { return 1; }\n`);
    write(root, 'src/barrel.ts', "export { implementation } from './sample.js';\n");
    write(root, 'test/sample.ts', `// @use-case ${target}\n// @name imports\nimport { implementation } from '../src/barrel.js';\nimport { spawn } from 'node:child_process';\nvoid import('./unknown.js');\nfetch('http://example.invalid');\nimplementation();\n`);
    const result = (await analyze(root)).observations[0]!;
    assert.equal(result.value.analyzer, 'typescript'); assert.equal(result.value.dependencies[0]?.scope, 'file');
    assert.ok(result.gaps.includes('FileScope')); assert.ok(result.gaps.includes('SubprocessBoundary')); assert.ok(result.gaps.includes('DynamicImport')); assert.ok(result.gaps.includes('NetworkBoundary'));
    assert.ok(result.value.dependencies[0]?.edges.some(edge => edge.from === 'src/barrel.ts' && edge.to === 'src/sample.ts'));
    const listed = await query(root, { name: 'code.list', input: {} }, codeList);
    assert.equal(listed.analysis.relevance.find(item => item.testId === result.value.dependencies[0]!.testId)?.relevance.verdict, 'observed');
    const id = result.value.dependencies[0]!.testId;
    write(root, 'test/sample.ts', `// @feature docs/feature/sample/README.md\n// @name imports\nimport { implementation } from '../src/barrel.js';\n`);
    const tests = await query(root, { name: 'test.list', input: {} }, Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) }));
    assert.ok(tests.cases.some(test => test.id === id));
    assert.equal((await query(root, { name: 'test.show', input: { id } }, Schema.Struct({ analysis: AnalysisViewSchema }))).analysis.relevance[0]?.relevance.verdict, 'not-observed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
