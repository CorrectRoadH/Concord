// 跨进程保证：外部程序——真实CLI分析使用TypeScript编译能力产生当前observation，缓存清除后仍可检查。
import { sourceCli, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceRoot, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.ts';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C2, C18; test-journey-steps C13, C15.
test('packed public CLI analyzes an isolated offline consumer without a source checkout', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-lsp-package-'));
  let root: string | undefined;
  const run = (command: string, args: readonly string[], cwd: string): string => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const { stdout, stderr } = result;
    assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, stdout + stderr);
    return stdout;
  };
  try {
    const binary = installedConcordCli();
    root = mkdtempSync(join(scratch, 'consumer-'));
    execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
    call(root, ['init', '--test-root', 'test', '--source-root', 'src'], ack, 0, binary);
    call(root, ['new', 'feature', 'sample', '--title', 'Sample'], ack, 0, binary);
    call(root, ['new', 'use-case', 'sample', '--feature', 'sample', '--title', 'Sample'], ack, 0, binary);
    write(root, 'src/sample.ts', `// @concord-file\n// @concord-implements ${target}\nexport const value = 1;\n`);
    write(root, 'test/sample.ts', `// @use-case ${target}\n// @name packed\nimport { value } from '../src/sample.js';\n`);
    assert.equal(call(root, ['check'], projectCheck, 0, binary).ok, true);
    const analyzed = call(root, ['code', 'analyze'], analysis, 0, binary);
    assert.equal(analyzed.observations[0]?.value.analyzer, 'typescript');
    assert.equal(analyzed.observations[0]?.current, true);
    assert.equal(call(root, ['code', 'list'], codeList, 0, binary).analysis.relevance[0]?.relevance.verdict, 'observed');
    assert.equal(call(root, ['check'], projectCheck, 0, binary).ok, true);
    call(root, ['cache', 'clear'], ack, 0, binary);
    assert.equal(call(root, ['check'], projectCheck, 0, binary).ok, true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
