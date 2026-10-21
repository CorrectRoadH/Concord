import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { buildSync } from 'esbuild';
import { analysisBudgets, LanguageServersSchema, type LanguageServer } from '../dist/language-server-config.js';
import { documentSymbols, positionOffset, bindSymbol } from '../dist/lsp-symbols.js';
import { LspConnection } from '../dist/lsp-protocol.js';
import { AnalysisObservationSchema } from '../dist/analysis-values.js';
import { AnalysisViewSchema, relevanceFor } from '../dist/analysis-view.js';
import { CodeDeclarationSchema } from '../dist/code.js';
import { decode, type AnnotatedCase, type DocumentRecord } from '../dist/shared.js';
import { observation } from '../dist/observation.js';
import { LocalRepository } from '../dist/storage.js';
import { withPersistentCache } from '../dist/cache-store.js';
import { observeOwnedProcessGroup } from '../dist/owned-process.js';
import { pollUntil, readProjectConfig, writeProjectConfig } from './support.js';

const cli = resolve('dist/entry.js');
const target = 'docs/feature/sample/use-case/sample.md';
const source = `# @concord-code\n# @concord-implements ${target}\ndef implementation():\n    return 1\n`;
function write(root: string, path: string, text: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
function call<A>(root: string, args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0, binary = cli, env = process.env): A {
  const result = spawnSync(process.execPath, [binary, '--root', root, '--json', '--fresh', ...args], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const text = result.stdout + result.stderr;
  assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, status, text);
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(JSON.parse(text));
}
const ack = Schema.Record(Schema.String, Schema.Unknown);
const failure = Schema.Struct({ error: Schema.String, message: Schema.String });
const analysis = Schema.Struct({ observations: Schema.Array(AnalysisObservationSchema) });
const codeList = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema), analysis: AnalysisViewSchema });
const projectCheck = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Unknown), complete: Schema.optional(Schema.Boolean) });
function server(mode = 'normal'): LanguageServer {
  return { id: 'python-fixture', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'server.mjs'], cwd: '.', environment: ['LANG'], initializationOptions: { mode }, implementationFiles: ['server.mjs'], sourceFiles: [], budgets: { totalMs: 5000, requestMs: 500 }, profile: { version: 'fixture-v1', serverVersion: '1.0.0', commentPrefixes: ['#'], declarationKinds: [5, 6, 12], symbolShape: 'document-symbol', decorators: 'at-line', leadingComments: true, readiness: { kind: 'progress', token: 'index' }, positionEncodings: ['utf-16'] } };
}
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-lsp-test-'));
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  call(root, ['init', '--test-root', 'test', '--source-root', 'src'], ack);
  call(root, ['feature', 'create', 'sample', '--title', 'Sample'], ack);
  call(root, ['use-case', 'create', 'sample', '--feature', 'sample', '--title', 'Sample'], ack);
  buildSync({ entryPoints: ['test/fixtures/lsp-server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'server.mjs'), logLevel: 'silent' });
  write(root, 'src/sample.py', source);
  write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\ndef test_sample():\n    helper()\n`);
  write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
  writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [server()] });
  return root;
}

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
    for (const [mode, expected] of [['timeout', 'AnalysisBudgetExceeded'], ['invalid-message', 'LanguageServerFailed'], ['unsafe-uri', 'LanguageServerFailed'], ['output-limit', 'AnalysisBudgetExceeded']] as const) {
      const config = server(mode);
      writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...config, budgets: { ...config.budgets, outputBytes: 8192 } }] });
      assert.equal(call(root, ['code', 'analyze'], failure, 1).error, expected);
      // A confirmed cleanup releases the runner; an ordinary source publication remains possible.
      assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    }
    const residual = server('residual');
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...residual, initializationOptions: { mode: 'residual', auditPath } }] });
    call(root, ['code', 'analyze'], analysis);
    const closed = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ pid: Schema.Number })), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(auditPath, 'utf8')));
    assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(closed[0]!.pid)));
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    const config = server();
    writeProjectConfig(root, { ...readProjectConfig(root), languageServers: [{ ...config, initializationOptions: { mutate: '../src/sample.py' } }] });
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'AnalysisSourceChanged');
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(auditPath, { force: true }); }
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
  const observed = observation({ analyzer: 'fixture', profile: 'fixture-v1', encoding: 'utf-16' as const, locators: [], dependencies: [{ testId: test.id, scope: 'file' as const, file: 'test/sample.py', declarations: [code.id], edges: [], gaps: ['FileScope'] }], gaps: ['OpenWorldCalls'] }, 'sha256:fixture', ['OpenWorldCalls'], true);
  const relevance = relevanceFor(test, [stepCode], [observed], docs, new Set([test.contract]));
  assert.equal(relevance.verdict, 'observed'); if (relevance.verdict === 'observed') assert.equal(relevance.level, 'step');
  assert.equal(relevanceFor(test, [{ ...code, contracts: ['docs/feature/other/README.md'] }], [observed], docs).verdict, 'not-observed');
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
    const packed = Schema.decodeUnknownSync(Schema.Struct({ filename: Schema.String }), { onExcessProperty: 'ignore' })(JSON.parse(run('pnpm', ['--config.ignore-scripts=true', 'pack', '--skip-manifest-obfuscation', '--json', '--pack-destination', scratch], process.cwd())));
    const install = join(scratch, 'install'); mkdirSync(install);
    run('tar', ['-xzf', resolve(scratch, packed.filename), '-C', install], scratch);
    const unpacked = join(install, 'package');
    // Match the release packer's fixed-lock identity without writing to the shared package store.
    copyFileSync('pnpm-lock.yaml', join(unpacked, 'pnpm-lock.yaml'));
    copyFileSync('pnpm-workspace.yaml', join(unpacked, 'pnpm-workspace.yaml'));
    run('pnpm', ['install', '--prod', '--offline', '--frozen-store', '--frozen-lockfile', '--ignore-scripts'], unpacked);
    const binary = join(unpacked, 'dist/entry.js');
    root = mkdtempSync(join(scratch, 'consumer-'));
    execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
    call(root, ['init', '--test-root', 'test', '--source-root', 'src'], ack, 0, binary);
    call(root, ['feature', 'create', 'sample', '--title', 'Sample'], ack, 0, binary);
    call(root, ['use-case', 'create', 'sample', '--feature', 'sample', '--title', 'Sample'], ack, 0, binary);
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
    const body = original.slice(original.indexOf('\n---\n') + 5).trim();
    const document = Schema.Struct({ document: Schema.Struct({ digest: Schema.String }) });
    const before = call(root, ['use-case', 'show', target], document).document.digest;
    active = start(); await waitStarted();
    write(root, '.git/body', body + '\n\nChanged during analysis.\n');
    call(root, ['author', 'set', target, '--body', join(root, '.git/body'), '--expected-digest', before], ack);
    const changed = call(root, ['use-case', 'show', target], document).document.digest;
    write(root, '.git/body', body + '\n');
    call(root, ['author', 'set', target, '--body', join(root, '.git/body'), '--expected-digest', changed], ack);
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
