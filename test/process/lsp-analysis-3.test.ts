// 跨进程保证：外部程序——真实外部adapter重新发现输入变化后使language server observation失效并重算native范围。
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import type { Schema} from '../support/lsp-analysis-fixture.ts';
import { sourceCli, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceRoot, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @name native-analysis-range-integration
// LSP C13: a real external adapter boundary supplies ranges; analysis and invalidation remain production code.
test('native manifests constrain LSP roots and changed observations invalidate identical repository inputs', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer(), external = mkdtempSync(join(tmpdir(), 'concord-analysis-provider-'));
  const statePath = join(external, 'state');
  const env = { ...process.env, ANALYSIS_ADAPTER_STATE: statePath };
  const invoke = <A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>) => call(root, args, schema, 0, cli, env);
  try {
    buildSync({ entryPoints: ['test/fixtures/analysis-adapter.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'analysis-adapter.mjs'), logLevel: 'silent' });
    write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\n# @native fixture:selected\ndef test_sample():\n    helper()\n\ndef unrelated():\n    return 0\n`);
    writeFileSync(statePath, 'first');
    writeProjectConfig(root, { ...readProjectConfig(root), testAdapters: [{ id: 'range-fixture', include: ['test/sample.py'], argv: [process.execPath, 'analysis-adapter.mjs'], implementationFiles: ['analysis-adapter.mjs'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['ANALYSIS_ADAPTER_STATE'] }] });
    const baseline = invoke(['check'], projectCheck);
    const initial = invoke(['code', 'analyze'], analysis).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(initial.value.dependencies[0]!.scope, 'file');
    assert.ok(initial.value.dependencies[0]!.gaps.includes('NativeObservationUnavailable'));
    invoke(['test', 'discover', 'test/sample.py'], ack);
    const first = invoke(['code', 'analyze'], analysis).observations.find(item => item.value.analyzer === 'python-fixture')!;
    const dependency = first.value.dependencies[0]!;
    assert.equal(dependency.scope, 'native-case');
    assert.ok(dependency.gaps.includes('ExternalInputUnknown'));
    assert.ok(!dependency.gaps.includes('FileScope'));
    assert.ok(dependency.declarations.length > 0);
    const listed = invoke(['code', 'list'], codeList).analysis.relevance[0]!;
    assert.equal(listed.scope, 'native-case'); assert.equal(listed.relevance.verdict, 'observed');
    writeFileSync(statePath, 'second');
    invoke(['test', 'discover', 'test/sample.py'], ack);
    assert.equal(invoke(['code', 'list'], codeList).analysis.observations.find(item => item.value.analyzer === 'python-fixture')!.current, false);
    const second = invoke(['code', 'analyze'], analysis).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(second.value.dependencies[0]!.native!.manifestInputs, dependency.native!.manifestInputs);
    assert.notEqual(second.value.dependencies[0]!.native!.manifestDigest, dependency.native!.manifestDigest);
    assert.notEqual(second.inputs, first.inputs);
    assert.equal(second.value.dependencies[0]!.scope, 'native-case');
    assert.deepEqual(second.value.dependencies[0]!.declarations, []);
    assert.equal(invoke(['code', 'list'], codeList).analysis.relevance[0]!.relevance.verdict, 'not-observed');
    stopWorkspaceServer(root);
    const repo = new LocalRepository(root);
    try { repo.snapshot(() => withPersistentCache(repo, true, database => {
      const row = database!.get('annotation_cache', ['native-inputs/v1/range-fixture'])[0]!;
      const payload = JSON.parse(row.payload) as { versions: { runtime: string } };
      payload.versions.runtime += '-external-change';
      database!.put('annotation_cache', [{ key: row.key, payload: JSON.stringify(payload) }]);
    })); } finally { repo.close(); }
    assert.equal(invoke(['code', 'list'], codeList).analysis.observations.find(item => item.value.analyzer === 'python-fixture')!.current, false);
    writeFileSync(statePath, 'no-range');
    invoke(['test', 'discover', 'test/sample.py'], ack);
    const fallback = invoke(['code', 'analyze'], analysis).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(fallback.value.dependencies[0]!.scope, 'file');
    assert.ok(fallback.value.dependencies[0]!.gaps.includes('NativeRangeUnavailable'));
    assert.ok(fallback.value.dependencies[0]!.gaps.includes('FileScope'));
    assert.deepEqual(invoke(['check'], projectCheck), baseline);
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
})));
