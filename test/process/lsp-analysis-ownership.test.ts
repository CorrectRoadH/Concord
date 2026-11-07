// 跨进程保证：进程终止与信号——真实分析CLI取消后回收language server进程组，持有runner期间拒绝竞争且A-B-A变更不发布。
import { sourceCli, createDocument, createConsumer, installedConcordCli, assert, execFileSync, spawn, spawnSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, dirname, join, resolve, tmpdir, test, Effect, Schema, buildSync, analysisBudgets, LanguageServersSchema, type LanguageServer, documentSymbols, positionOffset, bindSymbol, LspConnection, AnalysisObservationSchema, AnalysisViewSchema, historicalAnalysis, relevanceFor, CodeDeclarationSchema, decode, type AnnotatedCase, type DocumentRecord, observation, LocalRepository, withPersistentCache, observeOwnedProcessGroup, hydrateQueryValue, TraceShowValue, pollUntil, readProjectConfig, writeProjectConfig, sourceRoot, cli, target, source, write, call, ack, failure, analysis, codeList, projectCheck, server, consumer } from '../support/lsp-analysis-fixture.ts';
import { runCli } from '../support/cli.ts';


// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C6, C12, C16, C18.
test('analysis runner ownership survives cancellation and rejects coordinated A-B-A publication', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await consumer()), auditPath = join(tmpdir(), `concord-lsp-lifecycle-${process.pid}.json`);
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
  let active: Awaited<ReturnType<typeof start>> | undefined;
  const waitStarted = async () => await pollUntil(async () => {
    try {
      const log = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ pid: Schema.Number })), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(auditPath, 'utf8')));
      return log[0]?.pid;
    } catch { return undefined; }
  }, { timeoutMs: 15000, description: 'server initialized' });
  try {
    const config = server('timeout');
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [{ ...config, initializationOptions: { mode: 'timeout', auditPath }, budgets: { totalMs: 10000, requestMs: 5000 } }] });
    active = start(); const group = await waitStarted();
    assert.equal(call(root, ['code', 'analyze'], failure, 1).error, 'RepositoryBusy');
    // Source reads still work while the external server is waiting.
    assert.equal(call(root, ['check'], projectCheck).ok, true);
    active.child.kill('SIGINT'); assert.notEqual(await active.done, 0); active = undefined;
    assert.ok(['gone', 'zombie-only'].includes(observeOwnedProcessGroup(group)));
    assert.equal(call(root, ['recover'], Schema.Struct({ status: Schema.String })).status, 'clean');
    rmSync(auditPath, { force: true });
    const slow = server(), gatePath = join(root, '.git/continue-analysis');
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [{ ...slow, initializationOptions: { auditPath, gatePath }, budgets: { totalMs: 30000, requestMs: 10000 } }] });
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
test('explicit analysis attempts a configured executable and releases ownership when it is missing', async () => {
  const root = (await consumer());
  try {
    const profiles = [['python', '.py', '#'], ['go', '.go', '//'], ['rust', '.rs', '//'], ['java', '.java', '//']] as const;
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: profiles.map(([languageId, extension, prefix]) => ({ ...server(), id: languageId, languageId, extensions: [extension], argv: ['concord-server-that-must-not-start'], profile: { ...server().profile, commentPrefixes: [prefix] } })) });
    const invoke = async (args: readonly string[]) => runCli({ argv: ['--root', root, '--json', '--fresh', ...args], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    const analyzed = await invoke(['code', 'analyze']);
    assert.equal(analyzed.exitCode, 1, analyzed.stdout + analyzed.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(failure))(analyzed.stderr || analyzed.stdout).error, 'LanguageServerFailed');
    const recovered = await invoke(['recover']);
    assert.equal(recovered.exitCode, 0, recovered.stdout + recovered.stderr);
    assert.equal(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.String })))(recovered.stdout).status, 'clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
