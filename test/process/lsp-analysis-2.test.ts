import { packageBin, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, packConcord, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.js';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1-C5, C10, C12-C16, C18; test-journey-steps C6-C8, C13.
test('LSP observations retain marker identity, traverse test helpers, and never govern check', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const baseline = call(root, ['check'], projectCheck); assert.equal(baseline.ok, true);
    const before = call(root, ['code', 'list'], codeList);
    assert.equal(before.codes.length, 1); assert.equal(before.analysis.relevance[0]?.relevance.verdict, 'not-observed');
    const observed = call(root, ['code', 'analyze'], analysis).observations;
    const lsp = observed.find(value => value.value.analyzer === 'python-fixture')!;
    assert.equal(lsp.current, true); assert.equal(lsp.complete, false); assert.ok(lsp.gaps.includes('OpenWorldCalls'));
    assert.ok(lsp.gaps.includes('UnverifiedEnvironment'));
    assert.equal(lsp.value.locators[0]?.locator.name, 'implementation');
    assert.equal(lsp.value.locators[0]?.locator.range.start.line, 2);
    assert.ok(lsp.value.dependencies[0]?.edges.some(edge => edge.from === 'test/helper.py' && edge.to === 'src/sample.py'));
    const listed = call(root, ['code', 'list'], codeList);
    assert.deepEqual(listed.codes, before.codes);
    assert.equal(listed.analysis.relevance[0]?.relevance.verdict, 'observed');
    assert.ok(listed.analysis.relevance[0]?.relevance.gaps.includes('UnverifiedEnvironment'));
    assert.ok(listed.analysis.relevance[0]?.relevance.gaps.includes('FileScope'));
    const id = lsp.value.dependencies[0]!.testId;
    const externalEnvironment = call(root, ['code', 'list'], codeList, 0, cli, { ...process.env, LANG: 'concord-external-environment-change' });
    assert.equal(externalEnvironment.analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, true);
    const shown = call(root, ['test', 'show', id], Schema.Struct({ analysis: AnalysisViewSchema }));
    assert.equal(shown.analysis.relevance[0]?.relevance.verdict, 'observed');
    const traced = call(root, ['trace', 'show', 'docs/feature/sample/README.md'], Schema.Struct({ analysis: AnalysisViewSchema }));
    assert.equal(traced.analysis.relevance[0]?.relevance.verdict, 'observed');
    assert.deepEqual(call(root, ['check'], projectCheck), baseline);
    const implementation = readFileSync(join(root, 'server.mjs'), 'utf8');
    write(root, 'server.mjs', implementation + '\n// implementation changed\n');
    assert.equal(call(root, ['code', 'list'], codeList).analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, false);
    write(root, 'server.mjs', implementation);
    write(root, 'src/new-member.py', 'def new_member():\n    pass\n');
    assert.equal(call(root, ['code', 'list'], codeList).analysis.observations.find(value => value.value.analyzer === 'python-fixture')?.current, false);
    rmSync(join(root, 'src/new-member.py'));
    write(root, 'test/helper.py', 'def helper():\n    return 2\n');
    const stale = call(root, ['code', 'list'], codeList);
    assert.equal(stale.analysis.observations[1]?.current, false);
    assert.equal(stale.analysis.relevance[0]?.relevance.verdict, 'not-observed');
    assert.deepEqual(call(root, ['check'], projectCheck), baseline);
    write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
    const repeat = call(root, ['code', 'analyze'], analysis).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.deepEqual(repeat.value, lsp.value); assert.equal(repeat.inputs, lsp.inputs);
    const cacheRepo = new LocalRepository(root);
    try { cacheRepo.snapshot(() => withPersistentCache(cacheRepo, true, database => {
      const rows = database!.scan('code_cache');
      database!.put('code_cache', rows.map(row => ({ key: row.key, payload: '{damaged' })));
    })); } finally { cacheRepo.close(); }
    assert.deepEqual(call(root, ['check'], projectCheck), baseline);
    assert.deepEqual(call(root, ['code', 'list'], codeList).codes, before.codes);
    assert.equal(call(root, ['code', 'list'], codeList).analysis.observations.length, 0);
    const shallow = server(); writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...shallow, budgets: { ...shallow.budgets, depth: 1 } }] });
    const limited = call(root, ['code', 'analyze'], analysis).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.ok(limited.gaps.includes('DepthLimit')); assert.deepEqual(limited.value.dependencies[0]?.declarations, []);
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [server()] });
    call(root, ['cache', 'clear'], ack);
    assert.deepEqual(call(root, ['check'], projectCheck), baseline);
    assert.deepEqual(call(root, ['code', 'list'], codeList).codes, before.codes);
    assert.equal(call(root, ['code', 'list'], codeList).analysis.relevance[0]?.relevance.verdict, 'not-observed');
    const rebuilt = call(root, ['code', 'analyze'], analysis).observations.find(value => value.value.analyzer === 'python-fixture')!;
    assert.deepEqual(rebuilt.value, lsp.value);
    // A broken marker still fails when an earlier good observation exists.
    write(root, 'src/sample.py', '# @concord-code\ndef implementation():\n    return 1\n');
    const invalid = call(root, ['check'], projectCheck, 1); assert.equal(invalid.ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES test-journey-steps C6-C8; lsp-integration C4, C13, C14, C18.
test('TypeScript imports and reexports provide only file-scoped relevance with boundary gaps', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [] });
    write(root, 'src/sample.ts', `// @concord-code\n// @concord-implements ${target}\nexport function implementation() { return 1; }\n`);
    write(root, 'src/barrel.ts', "export { implementation } from './sample.js';\n");
    write(root, 'test/sample.ts', `// @use-case ${target}\n// @name imports\nimport { implementation } from '../src/barrel.js';\nimport { spawn } from 'node:child_process';\nvoid import('./unknown.js');\nfetch('http://example.invalid');\nimplementation();\n`);
    const result = call(root, ['code', 'analyze'], analysis).observations[0]!;
    assert.equal(result.value.analyzer, 'typescript'); assert.equal(result.value.dependencies[0]?.scope, 'file');
    assert.ok(result.gaps.includes('FileScope')); assert.ok(result.gaps.includes('SubprocessBoundary')); assert.ok(result.gaps.includes('DynamicImport')); assert.ok(result.gaps.includes('NetworkBoundary'));
    assert.ok(result.value.dependencies[0]?.edges.some(edge => edge.from === 'src/barrel.ts' && edge.to === 'src/sample.ts'));
    const listed = call(root, ['code', 'list'], codeList);
    assert.equal(listed.analysis.relevance.find(item => item.testId === result.value.dependencies[0]!.testId)?.relevance.verdict, 'observed');
    const id = result.value.dependencies[0]!.testId;
    write(root, 'test/sample.ts', `// @feature docs/feature/sample/README.md\n// @name imports\nimport { implementation } from '../src/barrel.js';\n`);
    const tests = call(root, ['test', 'list'], Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) }));
    assert.ok(tests.cases.some(test => test.id === id));
    assert.equal(call(root, ['test', 'show', id], Schema.Struct({ analysis: AnalysisViewSchema })).analysis.relevance[0]?.relevance.verdict, 'not-observed');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
