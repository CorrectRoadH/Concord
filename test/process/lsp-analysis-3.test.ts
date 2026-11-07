// 跨进程保证：外部程序——真实外部adapter重新发现输入变化后使language server observation失效并重算native范围。
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { Schema } from 'effect';
import { runCli } from '../support/cli.ts';
import { sourceCli, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceRoot, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @name native-analysis-range-integration
// LSP C13: a real external adapter boundary supplies ranges; analysis and invalidation remain production code.
test('native manifests constrain LSP roots and changed observations invalidate identical repository inputs', () => Effect.runPromise(Effect.promise(async () => {
  const root = (await consumer()), external = mkdtempSync(join(tmpdir(), 'concord-analysis-provider-'));
  const statePath = join(external, 'state');
  const env = { ...process.env, ANALYSIS_ADAPTER_STATE: statePath };
  const invoke = async <A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>): Promise<A> => {
    const result = await runCli({ argv: ['--root', root, '--json', '--fresh', ...args], cwd: root, env, signal: AbortSignal.timeout(30_000) });
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(JSON.parse(result.stdout));
  };
  try {
    buildSync({ entryPoints: ['test/fixtures/analysis-adapter.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'analysis-adapter.mjs'), logLevel: 'silent' });
    write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\n# @native fixture:selected\ndef test_sample():\n    helper()\n\ndef unrelated():\n    return 0\n`);
    writeFileSync(statePath, 'first');
    writeProjectConfig(root, { ...(await readProjectConfig(root)), testAdapters: [{ id: 'range-fixture', include: ['test/sample.py'], argv: [process.execPath, 'analysis-adapter.mjs'], implementationFiles: ['analysis-adapter.mjs'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['ANALYSIS_ADAPTER_STATE'] }] });
    const baseline = (await invoke(['check'], projectCheck));
    const initial = (await invoke(['code', 'analyze'], analysis)).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(initial.value.dependencies[0]!.scope, 'file');
    assert.ok(initial.value.dependencies[0]!.gaps.includes('NativeObservationUnavailable'));
    (await invoke(['test', 'discover', 'test/sample.py'], ack));
    const first = (await invoke(['code', 'analyze'], analysis)).observations.find(item => item.value.analyzer === 'python-fixture')!;
    const dependency = first.value.dependencies[0]!;
    assert.equal(dependency.scope, 'native-case');
    assert.ok(dependency.gaps.includes('ExternalInputUnknown'));
    assert.ok(!dependency.gaps.includes('FileScope'));
    assert.ok(dependency.declarations.length > 0);
    const listed = (await invoke(['code', 'list'], codeList)).analysis.relevance[0]!;
    assert.equal(listed.scope, 'native-case'); assert.equal(listed.relevance.verdict, 'observed');
    writeFileSync(statePath, 'second');
    (await invoke(['test', 'discover', 'test/sample.py'], ack));
    assert.equal((await invoke(['code', 'list'], codeList)).analysis.observations.find(item => item.value.analyzer === 'python-fixture')!.current, false);
    const second = (await invoke(['code', 'analyze'], analysis)).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(second.value.dependencies[0]!.native!.manifestInputs, dependency.native!.manifestInputs);
    assert.notEqual(second.value.dependencies[0]!.native!.manifestDigest, dependency.native!.manifestDigest);
    assert.notEqual(second.inputs, first.inputs);
    assert.equal(second.value.dependencies[0]!.scope, 'native-case');
    assert.deepEqual(second.value.dependencies[0]!.declarations, []);
    assert.equal((await invoke(['code', 'list'], codeList)).analysis.relevance[0]!.relevance.verdict, 'not-observed');
    stopWorkspaceServer(root);
    const repo = (await LocalRepository.open(root));
    try { repo.snapshot(() => withPersistentCache(repo, true, database => {
      const row = database!.get('annotation_cache', ['native-inputs/v1/range-fixture'])[0]!;
      const payload = JSON.parse(row.payload) as { versions: { runtime: string } };
      payload.versions.runtime += '-external-change';
      database!.put('annotation_cache', [{ key: row.key, payload: JSON.stringify(payload) }]);
    })); } finally { repo.close(); }
    assert.equal((await invoke(['code', 'list'], codeList)).analysis.observations.find(item => item.value.analyzer === 'python-fixture')!.current, false);
    writeFileSync(statePath, 'no-range');
    (await invoke(['test', 'discover', 'test/sample.py'], ack));
    const fallback = (await invoke(['code', 'analyze'], analysis)).observations.find(item => item.value.analyzer === 'python-fixture')!;
    assert.equal(fallback.value.dependencies[0]!.scope, 'file');
    assert.ok(fallback.value.dependencies[0]!.gaps.includes('NativeRangeUnavailable'));
    assert.ok(fallback.value.dependencies[0]!.gaps.includes('FileScope'));
    assert.deepEqual((await invoke(['check'], projectCheck)), baseline);
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
})));
