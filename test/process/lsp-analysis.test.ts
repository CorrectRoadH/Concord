import { packageBin, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceConcord, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.js';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1, C5, C6, C11, C12, C15.
test('LSP protocol fixtures reject unsafe responses, mutations, edits and execution requests', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const auditPath = join(tmpdir(), `concord-lsp-audit-${process.pid}.json`);
  try {
    for (const mode of ['flat', 'null', 'bad-range', 'no-capability', 'external-uri']) {
      writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [server(mode)] });
      const result = call(root, ['code', 'analyze'], analysis).observations.find(value => value.value.analyzer === 'python-fixture')!;
      if (mode !== 'external-uri') assert.deepEqual(result.value.locators, []);
      assert.ok(result.gaps.includes(mode === 'external-uri' ? 'ExternalTarget' : mode === 'no-capability' ? 'CapabilityMissing' : 'UnsupportedSymbolBinding'));
      assert.ok(result.gaps.includes('UnknownSubprocessBoundary'));
      assert.ok(result.gaps.includes('UnknownProtocolBoundary'));
      assert.ok(result.gaps.includes('UnknownDynamicDispatch'));
      assert.equal(call(root, ['check'], projectCheck).ok, true);
    }
    const edit = server('apply-edit');
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...edit, initializationOptions: { mode: 'apply-edit', auditPath } }] });
    call(root, ['code', 'analyze'], analysis);
    const log = Schema.decodeUnknownSync(Schema.Array(Schema.Record(Schema.String, Schema.Unknown)))(JSON.parse(readFileSync(auditPath, 'utf8')));
    assert.ok(log.some(item => item.id === 'edit' && (item.result as { applied?: boolean } | undefined)?.applied === false));
    assert.ok(log.some(item => item.id === 'execute' && item.error !== undefined));
    assert.equal(readFileSync(join(root, 'src/sample.py'), 'utf8'), source);
    for (const [mode, expected] of [['timeout', 'AnalysisBudgetExceeded'], ['invalid-message', 'LanguageServerFailed'], ['invalid-result', 'LanguageServerFailed'], ['unsafe-uri', 'LanguageServerFailed'], ['output-limit', 'AnalysisBudgetExceeded']] as const) {
      const config = server(mode);
      writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...config, budgets: { ...config.budgets, outputBytes: 8192 } }] });
      assert.equal(call(root, ['code', 'analyze'], failure, 1).error, expected);
      // A confirmed cleanup releases the runner; an ordinary source publication remains possible.
      assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    }
    const residual = server('residual');
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...residual, initializationOptions: { mode: 'residual', auditPath } }] });
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'LanguageServerFailed');
    const closed = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ pid: Schema.Number, residualPid: Schema.optional(Schema.Number) })), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(auditPath, 'utf8')));
    assert.ok(closed.some(item => item.residualPid !== undefined));
    assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(closed[0]!.pid)));
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    const config = server();
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...config, initializationOptions: { mutate: '../src/sample.py' } }] });
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'AnalysisSourceChanged');
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(auditPath, { force: true }); }
})));
