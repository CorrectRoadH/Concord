// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { setConfig, showConfig } from '../src/editing.js';
import { ConcordError } from '../src/shared.js';
import { initialize, LocalRepository } from '../src/storage.js';

if (process.platform === 'win32') {
  // @use-case docs/feature/feedback/use-case/triage-feedback.md
  test('Windows reports gh capability missing while API feedback remains available', async () => {
    const { checkGhConnection } = await import('../src/feedback-gh.js');
    const { fetchFeedback } = await import('../src/feedback-providers.js');
    const connection = { id: 'github-main', provider: 'github', transport: 'gh', owner: 'acme', repo: 'widgets' } as const;
    await assert.rejects(Effect.runPromise(checkGhConnection(process.cwd(), connection)), (cause) => cause instanceof ConcordError && cause.code === 'GhPlatformUnsupported');
    const api = await Effect.runPromise(fetchFeedback({ id: 'github-api', provider: 'github', credentialEnv: 'TEST_TOKEN', owner: 'acme', repo: 'widgets' }, {
      credential: 'fixture',
      transport: (request) => Effect.succeed({ status: 200, headers: {}, body: request.url.endsWith('/widgets') ? { id: 42 } : [] }),
    }));
    assert.equal(api.items.length, 0);
  });
} else {
const root = mkdtempSync(join(tmpdir(), 'concord-gh-fixture-'));
const bin = join(root, 'bin');
const consumer = join(root, 'consumer');
const scenario = join(root, 'scenario.json');
const calls = join(root, 'calls.ndjson');
const isolatedTmp = join(root, 'gh-tmp');
mkdirSync(bin);
mkdirSync(consumer);
mkdirSync(isolatedTmp);
execFileSync('git', ['init', '-q', consumer]);
writeFileSync(scenario, '{}');
writeFileSync(join(bin, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = JSON.parse(fs.readFileSync(${JSON.stringify(scenario)}, 'utf8'));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, cwd: process.cwd(), env: { GH_DEBUG: process.env.GH_DEBUG, GH_REPO: process.env.GH_REPO, GH_TELEMETRY: process.env.GH_TELEMETRY, GH_PROMPT_DISABLED: process.env.GH_PROMPT_DISABLED, GH_TOKEN: process.env.GH_TOKEN } }) + '\\n');
if (args[0] === '--version') { process.stdout.write('gh version 2.98.0 (fixture)\\n'); process.exit(0); }
if (args[0] === 'api' && args[1] === '--help') { process.stdout.write('--hostname --method --include\\n'); process.exit(0); }
if (mode.hang) { setInterval(() => {}, 1000); return; }
if (mode.lockCleanup) fs.chmodSync(${JSON.stringify(isolatedTmp)}, 0o500);
if (mode.oversize) { process.stdout.write('x'.repeat(3 * 1024 * 1024)); return; }
const endpoint = args.at(-1);
if (mode.auth) { process.stderr.write('gh auth login SECRET-DO-NOT-PRINT\\n'); process.exit(1); }
let status = 200;
let body;
if (endpoint === 'repos/acme/widgets') body = { id: mode.repositoryId || 42, full_name: mode.wrongName ? 'other/widgets' : 'acme/widgets' };
else if (endpoint.startsWith('repos/acme/widgets/issues?')) { const page=Number(new URL('https://api.github.com/'+endpoint).searchParams.get('page')); body = mode.totalLimit ? Array.from({length:100},(_,index)=>{ const number=(page-1)*100+index+1; return {id:100000+number,number,html_url:'https://github.com/acme/widgets/issues/'+number,title:'Issue '+number,body:'x'.repeat(16000),state:'open',updated_at:'2026-09-14T00:00:00Z'}; }) : [{ id: 101, number: 7, html_url: mode.badScope ? 'https://github.com/other/widgets/issues/7' : 'https://github.com/acme/widgets/issues/7', title: 'Broken widget', body: 'A report', state: 'open', updated_at: '2026-09-14T00:00:00Z' }]; }
else { status = 404; body = { message: 'Not Found' }; }
process.stdout.write('HTTP/2 ' + status + ' OK\\r\\ncontent-type: application/json\\r\\n\\r\\n' + JSON.stringify(body));
process.exitCode = status === 200 ? 0 : 1;
`, { mode: 0o755 });
const priorPath = process.env.PATH;
const priorToken = process.env.GH_TOKEN;
const priorDebug = process.env.GH_DEBUG;
const priorRepo = process.env.GH_REPO;
const priorTmp = process.env.TMPDIR;
process.env.PATH = `${bin}:${priorPath ?? ''}`;
process.env.GH_TOKEN = 'fixture-token';
process.env.GH_DEBUG = 'api';
process.env.GH_REPO = 'attacker/elsewhere';

const { checkGhConnection, fetchGhFeedback } = await import('../src/feedback-gh.js');
const { syncFeedback } = await import('../src/feedback.js');
const { startViewServer } = await import('../src/view-server.js');
const connection = { id: 'github-main', provider: 'github', transport: 'gh', owner: 'acme', repo: 'widgets' } as const;

function configure(): void {
  const initial = new LocalRepository(consumer, { initialize: true });
  try { initialize(initial); } finally { initial.close(); }
  const repo = new LocalRepository(consumer);
  try { const current = showConfig(repo); setConfig(repo, { ...current.config, feedbackConnections: [connection] }, current.digest); }
  finally { repo.close(); }
}

function errorCode(cause: unknown, code: string): boolean { return cause instanceof ConcordError && cause.code === code; }
function readCalls(): readonly { args: readonly string[]; cwd: string; env: Record<string, string | undefined> }[] {
  return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { args: readonly string[]; cwd: string; env: Record<string, string | undefined> }) : [];
}
async function waitForCall(after: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (readCalls().length > after) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail('gh fixture process did not start');
}
async function waitForSlot(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await Effect.runPromise(checkGhConnection(consumer, connection)); return; }
    catch (cause) { if (!errorCode(cause, 'GhBusy')) throw cause; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail('gh slot remained busy after feedback cancellation');
}

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('real gh process fixture uses isolated scope, fixed requests, strict identity, and atomic publication', async () => {
  try {
    configure();
    const checked = await Effect.runPromise(checkGhConnection(consumer, connection));
    assert.equal(checked.target, 'acme/widgets');
    assert.equal(existsSync(join(consumer, 'docs/issues/feedback-github-101.md')), false, 'check must not import or bind');
    const receipt = await Effect.runPromise(syncFeedback(consumer, connection.id));
    assert.equal(receipt.imported, 1);
    assert.equal(receipt.connection.provider, 'github');
    assert.equal(receipt.connection.repositoryId, '42');
    assert.equal(existsSync(join(consumer, 'docs/issues/feedback-github-101.md')), true);
    const apiCalls = readCalls().filter((call) => call.args[0] === 'api' && call.args[1] !== '--help');
    assert.deepEqual(apiCalls.map((call) => call.args.at(-1)), ['repos/acme/widgets', 'repos/acme/widgets', 'repos/acme/widgets/issues?state=all&per_page=100&page=1']);
    for (const call of apiCalls) {
      assert.equal(call.cwd.startsWith(consumer), false);
      assert.equal(call.env.GH_DEBUG, undefined);
      assert.equal(call.env.GH_REPO, undefined);
      assert.equal(call.env.GH_TELEMETRY, 'false');
      assert.equal(call.env.GH_PROMPT_DISABLED, '1');
      assert.equal(call.env.GH_TOKEN, 'fixture-token');
      assert.deepEqual(call.args.slice(0, 7), ['api', '--hostname', 'github.com', '--method', 'GET', '--include', call.args[6]]);
    }
    writeFileSync(scenario, JSON.stringify({ badScope: true }));
    await assert.rejects(Effect.runPromise(fetchGhFeedback(consumer, connection)), (cause) => errorCode(cause, 'FeedbackScopeMismatch'));
    writeFileSync(scenario, JSON.stringify({ repositoryId: 43 }));
    await assert.rejects(Effect.runPromise(syncFeedback(consumer, connection.id)), (cause) => errorCode(cause, 'ConnectionIdentityMismatch'));
    const configured = new LocalRepository(consumer);
    try { assert.equal(configured.config.feedbackConnections?.[0]?.provider === 'github' ? configured.config.feedbackConnections[0].repositoryId : undefined, '42'); }
    finally { configured.close(); }
    writeFileSync(scenario, JSON.stringify({ wrongName: true }));
    await assert.rejects(Effect.runPromise(checkGhConnection(consumer, connection)), (cause) => errorCode(cause, 'GhTargetInaccessible'));
    writeFileSync(scenario, JSON.stringify({ auth: true }));
    await assert.rejects(Effect.runPromise(checkGhConnection(consumer, connection)), (cause) => errorCode(cause, 'GhNotAuthenticated') && !String(cause).includes('SECRET-DO-NOT-PRINT'));
    writeFileSync(scenario, '{}');
    const entry = fileURLToPath(new URL('../src/entry.ts', import.meta.url));
    const cli = (...args: readonly string[]): unknown => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', entry, '--root', consumer, '--json', ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 })) as unknown;
    const added = cli('feedback', 'connection', 'add', '--id', 'gh-cli', '--provider', 'github', '--transport', 'gh', '--owner', 'acme', '--repo', 'widgets');
    assert.ok(added);
    const cliCheck = cli('feedback', 'connection', 'check', 'gh-cli') as { target: string; transport: string };
    assert.deepEqual({ target: cliCheck.target, transport: cliCheck.transport }, { target: 'acme/widgets', transport: 'gh' });
    const actionPath = join(root, 'check-action.json');
    writeFileSync(actionPath, JSON.stringify({ action: 'feedback.check', connection: 'gh-cli' }));
    assert.equal((cli('action', '--input', actionPath) as { target: string }).target, 'acme/widgets');
    const rejected = spawnSync(process.execPath, ['--import', 'tsx', entry, '--root', consumer, '--json', 'feedback', 'connection', 'add', '--id', 'bad-gh', '--provider', 'github', '--transport', 'gh', '--credential-env', 'BAD', '--owner', 'acme', '--repo', 'widgets'], { cwd: process.cwd(), encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(rejected.status, 0);
    assert.equal((JSON.parse(rejected.stderr.trim()) as { error: string }).error, 'InvalidOption');
    writeFileSync(scenario, JSON.stringify({ oversize: true }));
    await assert.rejects(Effect.runPromise(checkGhConnection(consumer, connection)), (cause) => errorCode(cause, 'GhLimitExceeded'));
    writeFileSync(scenario, JSON.stringify({ totalLimit: true }));
    await assert.rejects(Effect.runPromise(fetchGhFeedback(consumer, connection)), (cause) => errorCode(cause, 'GhLimitExceeded'));
    writeFileSync(scenario, JSON.stringify({ hang: true }));
    const controller = new AbortController();
    const cancelled = Effect.runPromise(fetchGhFeedback(consumer, connection), { signal: controller.signal });
    setTimeout(() => controller.abort(), 800);
    await assert.rejects(cancelled);
    writeFileSync(scenario, '{}');
    assert.equal((await Effect.runPromise(checkGhConnection(consumer, connection))).target, 'acme/widgets', 'slot must be reusable after confirmed cancellation');
    const server = await startViewServer({ root: consumer, host: '127.0.0.1', port: 0 });
    const endpoint = `http://127.0.0.1:${server.port}/api/action`;
    const post = (signal?: AbortSignal) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'feedback.check', connection: connection.id }), signal });
    try {
      const normal = await post();
      assert.equal(normal.status, 200, 'normal request body completion must not cancel the check');
      assert.equal((await normal.json() as { ok: boolean }).ok, true);
      writeFileSync(scenario, JSON.stringify({ hang: true }));
      const disconnected = new AbortController();
      const beforeDisconnect = readCalls().length;
      const pendingDisconnect = post(disconnected.signal);
      await waitForCall(beforeDisconnect + 2);
      disconnected.abort();
      await assert.rejects(pendingDisconnect);
      writeFileSync(scenario, '{}');
      await waitForSlot();
      writeFileSync(scenario, JSON.stringify({ hang: true }));
      const beforeShutdown = readCalls().length;
      const pendingShutdown = post();
      await waitForCall(beforeShutdown + 2);
      await server.close();
      const shutdownResponse = await pendingShutdown;
      assert.equal(shutdownResponse.ok, false);
    } finally { await server.close(); }
    process.env.TMPDIR = isolatedTmp;
    writeFileSync(scenario, JSON.stringify({ lockCleanup: true }));
    await assert.rejects(Effect.runPromise(checkGhConnection(consumer, connection)), (cause) => errorCode(cause, 'GhCleanupUnconfirmed'));
    const count = readCalls().length;
    await assert.rejects(Effect.runPromise(checkGhConnection(consumer, connection)), (cause) => errorCode(cause, 'GhCleanupUnconfirmed'));
    assert.equal(readCalls().length, count, 'poisoned slot must not start another process');
  } finally {
    try { const { chmodSync } = await import('node:fs'); chmodSync(isolatedTmp, 0o700); } catch { /* fixture may already be removed */ }
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorToken === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = priorToken;
    if (priorDebug === undefined) delete process.env.GH_DEBUG; else process.env.GH_DEBUG = priorDebug;
    if (priorRepo === undefined) delete process.env.GH_REPO; else process.env.GH_REPO = priorRepo;
    if (priorTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = priorTmp;
    rmSync(root, { recursive: true, force: true });
  }
});
}
