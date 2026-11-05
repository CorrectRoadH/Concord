import { packageBin, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceConcord, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @issue docs/issues/test-architecture-gaps.md
test('installed CLI exposes a real language server observation through code, test and trace commands', () => {
  const root = consumer();
  try {
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...server(), budgets: { totalMs: 20_000, requestMs: 5000 } }] });
    const observed = call(root, ['code', 'analyze'], analysis).observations.find(value => value.value.analyzer === 'python-fixture')!;
    const id = observed.value.dependencies[0]!.testId;
    for (const args of [['code', 'list'], ['test', 'show', id], ['trace', 'show', target]]) {
      const result = call(root, args, Schema.Struct({ analysis: AnalysisViewSchema }));
      assert.equal(result.analysis.relevance.find(item => item.testId === id)?.relevance.verdict, 'observed');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
