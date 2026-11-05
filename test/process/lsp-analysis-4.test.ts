import { packageBin, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceConcord, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.js';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C11; test-journey-steps C6, C7.
test('range encoding, profile policy and relevance levels stay explicit', () => Effect.runPromise(Effect.sync(() => {
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 5 }, 'utf-8'), 3);
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 2 }, 'utf-32'), 3);
  assert.equal(positionOffset('a😀z\n', { line: 0, character: 3 }, 'utf-16'), 3);
  assert.throws(() => positionOffset('a😀z', { line: 0, character: 2 }, 'utf-16'));
  const symbol = { name: 'implementation', kind: 12, range: { start: { line: 2, character: 0 }, end: { line: 3, character: 12 } }, selectionRange: { start: { line: 2, character: 4 }, end: { line: 2, character: 18 } } };
  const parsed = documentSymbols([symbol], source, 'utf-16', 100);
  assert.deepEqual(parsed.gaps, []);
  const code = { id: 'code-sample', file: 'src/sample.py', line: 1, endLine: 1, scope: 'node' as const, contracts: [target] };
  assert.equal(bindSymbol(code, source, parsed.symbols, server(), 'utf-16')?.name, 'implementation');
  assert.equal(bindSymbol(code, source, [symbol, symbol], server(), 'utf-16'), undefined);
  assert.deepEqual(documentSymbols([{ ...symbol, children: [{ ...symbol, range: { start: { line: 0, character: 0 }, end: { line: 3, character: 12 } } }] }], source, 'utf-16', 100).gaps, ['UnsupportedSymbolBinding']);
  const test = { id: 'test-sample', contract: `${target}#step-one` } as AnnotatedCase;
  const docs = [{ path: target, metadata: { kind: 'use-case', feature: 'docs/feature/sample/README.md' } }] as DocumentRecord[];
  const stepCode = { ...code, contracts: [test.contract] };
  const observed = observation({ analyzer: 'fixture', profile: 'fixture-v1', encoding: 'utf-16' as const, locators: [], dependencies: [{ testId: test.id, scope: 'file' as const, file: 'test/sample.py', declarations: [code.id], edges: [], gaps: ['FileScope'] }], gaps: ['OpenWorldCalls'] }, 'sha256:fixture', ['OpenWorldCalls'], true, '2026-10-30T00:00:00.000Z');
  const relevance = relevanceFor(test, [stepCode], [observed], docs, new Set([test.contract]));
  assert.equal(relevance.verdict, 'observed'); if (relevance.verdict === 'observed') assert.equal(relevance.level, 'step');
  assert.equal(relevanceFor(test, [{ ...code, contracts: ['docs/feature/other/README.md'] }], [observed], docs).verdict, 'not-observed');
  const unavailable = { observations: [], relevance: [{ testId: test.id, scope: 'file' as const, relevance: { verdict: 'not-observed' as const, gaps: ['NoAnalyzer', 'FileScope'] as [string, ...string[]] }, message: '未观察到交集' }] };
  assert.deepEqual(historicalAnalysis(unavailable), unavailable);
})));


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C15, C18.
test('bounded JSON-RPC framing rejects malformed messages and cancels timed out requests', () => Effect.runPromise(Effect.gen(function* () {
  const rpc = new LspConnection({ ...analysisBudgets(), requestMs: 20 });
  const sent: string[] = []; rpc.connect(bytes => sent.push(bytes));
  const result = yield* Effect.result(rpc.request('initialize', {}));
  assert.equal(result._tag, 'Failure'); assert.ok(sent.some(bytes => bytes.includes('$/cancelRequest')));
  const invalid = new LspConnection(analysisBudgets()); invalid.connect(() => {});
  invalid.receive(Buffer.from('Content-Length: 1\r\nContent-Length: 1\r\n\r\nx'));
  assert.throws(() => invalid.assertHealthy());
  assert.throws(() => decode(LanguageServersSchema, [server(), server()], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), id: 'typescript' }], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), extensions: ['.ts'] }], 'server config'));
  assert.throws(() => decode(LanguageServersSchema, [{ ...server(), budgets: { depth: 33 } }], 'server config'));
})));


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


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C12, C16, C18.
test('analysis runner ownership survives cancellation and rejects coordinated A-B-A publication', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer(), auditPath = join(tmpdir(), `concord-lsp-lifecycle-${process.pid}.json`);
  const start = () => {
    const child = spawn(process.execPath, [cli, '--root', root, '--json', 'code', 'analyze'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
    const done = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { child, done, output: () => output };
  };
  let active: ReturnType<typeof start> | undefined;
  const waitStarted = async () => await pollUntil(async () => {
    try {
      const log = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ pid: Schema.Number })), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(auditPath, 'utf8')));
      return log[0]?.pid;
    } catch { return undefined; }
  }, { timeoutMs: 15000, description: 'server initialized' });
  try {
    const config = server('timeout');
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...config, initializationOptions: { mode: 'timeout', auditPath }, budgets: { totalMs: 10000, requestMs: 5000 } }] });
    active = start(); const group = await waitStarted();
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'RepositoryBusy');
    // Source reads still work while the external server is waiting.
    assert.equal(call(root, ['check'], projectCheck).ok, true);
    active.child.kill('SIGINT'); assert.notEqual(await active.done, 0); active = undefined;
    assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(group)));
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    rmSync(auditPath, { force: true });
    const slow = server(), gatePath = join(root, '.git/continue-analysis');
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...slow, initializationOptions: { auditPath, gatePath }, budgets: { totalMs: 30000, requestMs: 10000 } }] });
    const original = readFileSync(join(root, target), 'utf8');
    const body = original.trim();
    const document = Schema.Struct({ document: Schema.Struct({ digest: Schema.String }) });
    const before = call(root, ['show', target], document).document.digest;
    active = start(); await waitStarted();
    write(root, '.git/body', body + '\n\nChanged during analysis.\n');
    write(root, '.git/action.json', JSON.stringify({ action: 'document.set', path: target, body: body + '\n\nChanged during analysis.\n', expectedDigest: before }));
    call(root, ['action', '--input', join(root, '.git/action.json')], ack);
    const changed = call(root, ['show', target], document).document.digest;
    write(root, '.git/body', body + '\n');
    write(root, '.git/action.json', JSON.stringify({ action: 'document.set', path: target, body: original, expectedDigest: changed }));
    call(root, ['action', '--input', join(root, '.git/action.json')], ack);
    assert.equal(readFileSync(join(root, target), 'utf8'), original);
    writeFileSync(gatePath, 'continue');
    assert.equal(await active.done, 1);
    const failed = Schema.decodeUnknownSync(failure, { onExcessProperty: 'ignore' })(JSON.parse(active.output()));
    assert.equal(failed.error, 'AnalysisSourceChanged'); active = undefined;
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
  } finally {
    if (active !== undefined) { active.child.kill('SIGINT'); await active.done; }
    rmSync(root, { recursive: true, force: true }); rmSync(auditPath, { force: true });
  }
})));


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1, C2, C14, C18.
test('Python Go Rust and Java marker profiles rebuild relations without launching a server', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  try {
    const profiles = [['python', '.py', '#'], ['go', '.go', '//'], ['rust', '.rs', '//'], ['java', '.java', '//']] as const;
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: profiles.map(([languageId, extension, prefix]) => ({ ...server(), id: languageId, languageId, extensions: [extension], argv: ['concord-server-that-must-not-start'], profile: { ...server().profile, commentPrefixes: [prefix] } })) });
    for (const [, extension, prefix] of profiles) write(root, `src/markers${extension}`, `${prefix} @concord-file\n${prefix} @concord-implements ${target}\n${prefix} @concord-code\n${prefix} @concord-implements ${target}\nfunction body\n${prefix} @concord-begin\n${prefix} @concord-implements ${target}\nstatements\n${prefix} @concord-end\n`);
    write(root, 'test/labels.py', '@pytest.mark.bad_target("docs/missing.md")\ndef no_concord_marker():\n    pass\n');
    const before = call(root, ['code', 'list'], codeList).codes;
    assert.equal(before.filter(code => code.file.includes('markers')).length, 12);
    assert.equal(call(root, ['check'], projectCheck).ok, true);
    const text = readFileSync(join(root, 'src/markers.go'), 'utf8');
    write(root, 'src/markers.go', `\n\n${text}`);
    assert.deepEqual(call(root, ['code', 'list'], codeList).codes.map(code => code.id), before.map(code => code.id));
    write(root, 'src/markers.rs', text + '// @concord-end\n');
    assert.equal(call(root, ['check'], projectCheck, 1).ok, false);
    // Explicit analysis alone attempts the configured executable.
    write(root, 'src/markers.rs', text);
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'LanguageServerFailed');
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
})));


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1, C11.
test('decorated classes do not replace nearer same-named methods during binding', () => Effect.runPromise(Effect.sync(() => {
  const text = `# @concord-code\n# @concord-implements ${target}\n@decorator\nclass Box:\n    # @concord-code\n    # @concord-implements ${target}\n    @decorator\n    def same(self):\n        return 1\n    # @concord-code\n    # @concord-implements ${target}\n    def same(self):\n        return 2\n`;
  const range = (start: number, end: number, startColumn = 4, endColumn = 16) => ({ start: { line: start, character: startColumn }, end: { line: end, character: endColumn } });
  const first = { name: 'same', kind: 6, range: range(7, 8), selectionRange: range(7, 7, 8, 12) };
  const second = { name: 'same', kind: 6, range: range(11, 12), selectionRange: range(11, 11, 8, 12) };
  const outer = { name: 'Box', kind: 5, range: range(3, 12, 0), selectionRange: range(3, 3, 6, 9), children: [first, second] };
  const symbols = documentSymbols([outer], text, 'utf-16', 20); assert.deepEqual(symbols.gaps, []);
  const declaration = { id: 'code-example', file: 'src/sample.py', line: 5, endLine: 5, scope: 'node' as const, contracts: [target] };
  assert.deepEqual(bindSymbol(declaration, text, symbols.symbols, server(), 'utf-16')?.range, first.range);
  assert.deepEqual(bindSymbol({ ...declaration, line: 10 }, text, symbols.symbols, server(), 'utf-16')?.range, second.range);
  assert.equal(bindSymbol(declaration, text, symbols.symbols, { ...server(), profile: { ...server().profile, decorators: 'none' } }, 'utf-16'), undefined);
})));
