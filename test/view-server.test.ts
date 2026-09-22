import { deriveTestReference } from '../dist/test-reference.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { ViewJobManager } from '../dist/view-jobs.js';
import { formatViewAddress, startViewServer, type ViewServerHandle } from '../dist/view-server.js';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-view-'));
  execFileSync('git', ['init', '-q', root]);
  const webRoot = join(root, 'web-dist');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><main>application shell</main>');
  writeFileSync(join(webRoot, 'assets/app.js'), 'globalThis.loaded = true;\n');
  return { root, webRoot };
};

interface ResponseResult { readonly status: number; readonly type: string | undefined; readonly body: string }
function send(server: ViewServerHandle, path: string, options: { readonly method?: string; readonly headers?: Readonly<Record<string, string>>; readonly body?: string } = {}): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port: server.port, path, method: options.method ?? 'GET', headers: options.headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    });
    call.once('error', reject);
    if (options.body !== undefined) call.write(options.body);
    call.end();
  });
}

function sendRaw(server: ViewServerHandle, requestText: string): Promise<ResponseResult> {
  return new Promise((resolve, reject) => {
    const socket = connect(server.port, '127.0.0.1', () => socket.end(requestText));
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', reject);
    socket.once('end', () => {
      const response = Buffer.concat(chunks).toString('utf8');
      const separator = response.indexOf('\r\n\r\n');
      const head = separator === -1 ? response : response.slice(0, separator);
      const body = separator === -1 ? '' : response.slice(separator + 4);
      const status = Number(/^HTTP\/1\.1 ([0-9]{3})/u.exec(head)?.[1] ?? '0');
      const type = /^content-type:\s*(.+)$/imu.exec(head)?.[1]?.trim();
      resolve({ status, type, body });
    });
  });
}

const parsed = (response: ResponseResult): { readonly ok: boolean; readonly value?: unknown; readonly error?: string } => JSON.parse(response.body) as { readonly ok: boolean; readonly value?: unknown; readonly error?: string };
const jsonHeaders = { 'content-type': 'application/json' };

async function waitFor(manager: ViewJobManager, id: string, state: readonly string[], timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = manager.list().find((item) => item.id === id);
    if (job !== undefined && state.includes(job.state)) return job;
    if (Date.now() >= deadline) throw new Error(`job ${id} did not reach ${state.join('/')}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view server keeps the application shell data-free and allows unauthenticated access and enforces authority, strict JSON, and API fallback', async () => {
  const { root, webRoot } = fixture();
  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0, webRoot });
    const shell = await send(server, '/workspace/deep-link');
    assert.equal(shell.status, 200);
    assert.equal(shell.body, '<!doctype html><main>application shell</main>');
    assert.match(shell.type ?? '', /^text\/html/u);

    const customAuthority = `concord.example.test:${server.port}`;
    const customShell = await send(server, '/workspace/from-proxy', { headers: { host: customAuthority } });
    assert.equal(customShell.status, 200);
    const openAccess = await send(server, '/api/workspace', { headers: { host: customAuthority } });
    assert.equal(openAccess.status, 200);
    const httpSameOrigin = await send(server, '/api/workspace', { headers: { host: customAuthority, origin: `http://${customAuthority}` } });
    assert.equal(httpSameOrigin.status, 200, httpSameOrigin.body);
    const httpsDefaultPort = await send(server, '/api/workspace', { headers: { host: 'concord.example.test:443', origin: 'https://concord.example.test' } });
    assert.equal(httpsDefaultPort.status, 200, httpsDefaultPort.body);
    const explicitOriginDefaultPort = await send(server, '/api/workspace', { headers: { host: 'concord.example.test', origin: 'https://concord.example.test:443' } });
    assert.equal(explicitOriginDefaultPort.status, 200, explicitOriginDefaultPort.body);
    const natAuthority = '192.0.2.44:7443';
    const nat = await send(server, '/api/workspace', { headers: { host: natAuthority, origin: `https://${natAuthority}` } });
    assert.equal(nat.status, 200, nat.body);
    const ipv6Authority = '[2001:db8::1]:7443';
    const ipv6 = await send(server, '/api/workspace', { headers: { host: ipv6Authority, origin: `https://${ipv6Authority}` } });
    assert.equal(ipv6.status, 200, ipv6.body);
    const forbiddenOrigin = await send(server, '/api/workspace', { headers: { host: customAuthority, origin: `http://other.example.test:${server.port}` } });
    assert.equal(forbiddenOrigin.status, 403);
    const wrongDefaultPort = await send(server, '/api/workspace', { headers: { host: 'concord.example.test:443', origin: 'http://concord.example.test' } });
    assert.equal(wrongDefaultPort.status, 403);
    const ignoredForwardedHost = await send(server, '/api/workspace', { headers: { host: customAuthority, origin: 'https://public.example.test', 'x-forwarded-host': 'public.example.test' } });
    assert.equal(ignoredForwardedHost.status, 403);
    const nullOrigin = await send(server, '/api/workspace', { headers: { host: customAuthority, origin: 'null' } });
    assert.equal(nullOrigin.status, 403);

    for (const headers of [
      { ...jsonHeaders, host: 'user@concord.example.test' },
      { ...jsonHeaders, host: customAuthority, origin: 'https://other.example.test' },
    ]) {
      const rejectedWrite = await send(server, '/api/action', { method: 'POST', headers, body: JSON.stringify({ action: 'init', docsOnly: true }) });
      assert.equal(rejectedWrite.status, 403);
      assert.equal(existsSync(join(root, 'concord.config.ts')), false);
      const rejectedJob = await send(server, '/api/jobs', { method: 'POST', headers, body: JSON.stringify({ caseId: viewJobCase }) });
      assert.equal(rejectedJob.status, 403);
      assert.deepEqual(parsed(await send(server, '/api/jobs')).value, []);
    }

    const empty = await send(server, '/api/workspace');
    assert.equal(empty.status, 200);
    assert.equal((parsed(empty).value as { project: unknown }).project, null);

    const excess = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'init', docsOnly: true, extra: true }) });
    assert.equal(excess.status, 400);
    assert.equal(parsed(excess).error, 'InvalidData');
    const wrongType = await send(server, '/api/action', { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 400);

    const initialized = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'init', docsOnly: true }) });
    assert.equal(initialized.status, 200, initialized.body);
    const created = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'document.create', kind: 'feature', id: 'web', title: 'Web' }) });
    assert.equal(created.status, 200, created.body);
    assert.equal(existsSync(join(root, 'docs/feature/web/cli.md')), false);
    for (const [id, kind, pages] of [['unknown-page', 'feature', ['other']], ['duplicate-page', 'feature', ['cli', 'cli']], ['engineering-pages', 'engineering', []]] as const) {
      const invalid = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'document.create', kind, id, title: id, pages }) });
      assert.equal(invalid.status, 400, invalid.body);
      assert.equal(existsSync(join(root, `docs/${kind}/${id}`)), false);
    }
    const workspace = await send(server, '/api/workspace');
    assert.equal((parsed(workspace).value as { documents: unknown[] }).documents.length, 1);
    const file = await send(server, '/api/file?path=docs%2Ffeature%2Fweb%2FREADME.md');
    assert.equal(file.status, 200, file.body);
    assert.equal((parsed(file).value as { documentPath: string }).documentPath, 'docs/feature/web/README.md');
    const git = await send(server, '/api/git');
    assert.equal(git.status, 200, git.body);

    const unknown = await send(server, '/api/not-real');
    assert.equal(unknown.status, 404);
    assert.match(unknown.type ?? '', /^application\/json/u);
    assert.equal(unknown.body.includes('application shell'), false);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view server rejects malformed or ambiguous authorities and non-origin-form request targets over HTTP', async () => {
  const { root, webRoot } = fixture();
  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0, webRoot });
    const connection = 'Connection: close\r\n';
    const invalidHosts = [
      `user@concord.example.test:${server.port}`,
      `concord.example.test:${server.port}/path`,
      `concord.example.test:0`,
      `concord.example.test:065`,
      '127.000.0.1',
      '::1',
    ];
    for (const host of invalidHosts) {
      const response = await sendRaw(server, `GET /api/workspace HTTP/1.1\r\nHost: ${host}\r\n${connection}\r\n`);
      assert.equal(response.status, 403, `${host}: ${response.body}`);
      assert.equal(parsed(response).error, 'ForbiddenAuthority');
    }

    const duplicateHost = await sendRaw(server, `GET /api/workspace HTTP/1.1\r\nHost: concord.example.test:${server.port}\r\nHost: attacker.example.test:${server.port}\r\n${connection}\r\n`);
    assert.equal(duplicateHost.status, 403, duplicateHost.body);
    assert.equal(parsed(duplicateHost).error, 'ForbiddenAuthority');
    const duplicateOrigin = await sendRaw(server, `GET /api/workspace HTTP/1.1\r\nHost: concord.example.test:${server.port}\r\nOrigin: http://concord.example.test:${server.port}\r\nOrigin: http://attacker.example.test:${server.port}\r\n${connection}\r\n`);
    assert.equal(duplicateOrigin.status, 403, duplicateOrigin.body);
    assert.equal(parsed(duplicateOrigin).error, 'ForbiddenAuthority');

    const hostileTargets = [
      'http://attacker.example.test/api/workspace',
      '//attacker.example.test/api/workspace',
      '/\\attacker.example.test/api/workspace',
    ];
    for (const target of hostileTargets) {
      const response = await sendRaw(server, `GET ${target} HTTP/1.1\r\nHost: concord.example.test:${server.port}\r\n${connection}\r\n`);
      assert.equal(response.status, 400, `${target}: ${response.body}`);
      assert.equal(parsed(response).error, 'InvalidUrl');
    }
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view CLI propagates or rejects shared dry-run without cache or repository writes', () => {
  const { root } = fixture();
  const cli = join(process.cwd(), 'dist/entry.js');
  try {
    const input = join(root, 'action.json');
    writeFileSync(input, JSON.stringify({ action: 'init', docsOnly: true }));
    const preview = spawnSync(process.execPath, [cli, '--root', root, '--dry-run', '--json', 'action', '--input', input], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal((JSON.parse(preview.stdout) as { dryRun: boolean }).dryRun, true);
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    assert.equal(existsSync(join(root, '.git/concord')), false);

    const rejected = spawnSync(process.execPath, [cli, '--root', root, '--dry-run', '--json', 'view', '--port', '0'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(rejected.status, 1);
    assert.equal((JSON.parse(rejected.stderr) as { error: string }).error, 'InvalidOption');

    let repo = new LocalRepository(root, { initialize: true });
    initialize(repo, false, { testRoots: [] });
    repo.close();
    writeFileSync(input, JSON.stringify({ action: 'recover' }));
    const unsafePreview = spawnSync(process.execPath, [cli, '--root', root, '--dry-run', '--json', 'action', '--input', input], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(unsafePreview.status, 1);
    assert.equal((JSON.parse(unsafePreview.stderr) as { error: string }).error, 'InvalidOption');
    const cache = join(root, '.git/concord/cache.sqlite');
    assert.equal(existsSync(cache), false);
    const workspace = spawnSync(process.execPath, [cli, '--root', root, '--dry-run', '--json', 'workspace', 'show'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(workspace.status, 0, workspace.stderr);
    assert.equal((JSON.parse(workspace.stdout) as { cache: { status: string } }).cache.status, 'off');
    assert.equal(existsSync(cache), false);

    assert.equal(formatViewAddress('0.0.0.0', 4317), 'http://localhost:4317/');
    assert.equal(formatViewAddress('192.0.2.10', 4317), 'http://192.0.2.10:4317/');
    assert.equal(formatViewAddress('::1', 4317), 'http://[::1]:4317/');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workspace diagnostics never dereference unsafe config or evidence paths', async () => {
  const { root, webRoot } = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'concord-view-outside-'));
  let server: ViewServerHandle | undefined;
  try {
    const secret = 'must-not-cross-the-worktree-boundary';
    writeFileSync(join(outside, 'secret.json'), secret);
    symlinkSync(join(outside, 'secret.json'), join(root, 'concord.config.ts'));
    server = await startViewServer({ root, host: '127.0.0.1', port: 0, webRoot });
    const linked = await send(server, '/api/workspace');
    assert.equal(linked.status, 200);
    const linkedValue = parsed(linked).value as { pages: unknown[]; configDigest: string | null; diagnostics: { error: string } };
    assert.deepEqual(linkedValue.pages, []);
    assert.equal(linkedValue.configDigest, null);
    assert.equal(linkedValue.diagnostics.error, 'UnsafePath');
    assert.equal(linked.body.includes(secret), false);

    rmSync(join(root, 'concord.config.ts'));
    writeFileSync(join(root, 'concord.config.ts'), 'x'.repeat(4 * 1024 * 1024 + 1));
    const oversize = await send(server, '/api/workspace');
    assert.equal(oversize.status, 200);
    const oversizeValue = parsed(oversize).value as { pages: unknown[]; configDigest: string | null; diagnostics: { error: string } };
    assert.deepEqual(oversizeValue.pages, []);
    assert.equal(oversizeValue.configDigest, null);
    assert.equal(oversizeValue.diagnostics.error, 'InvalidFile');
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }

  const initialized = initializedJobFixture();
  const evidenceOutside = mkdtempSync(join(tmpdir(), 'concord-view-evidence-'));
  server = undefined;
  try {
    writeFileSync(join(evidenceOutside, 'ccev_0123456789abcdef0123456789abcdef.json'), '{}');
    symlinkSync(evidenceOutside, join(initialized, '.git/concord/evidence'), 'dir');
    server = await startViewServer({ root: initialized, host: '127.0.0.1', port: 0, webRoot: join(initialized, 'web-dist') });
    const response = await send(server, '/api/workspace');
    assert.equal(response.status, 400);
    assert.equal(parsed(response).error, 'UnsafePath');
  } finally {
    await server?.close();
    rmSync(initialized, { recursive: true, force: true });
    rmSync(evidenceOutside, { recursive: true, force: true });
  }
});

const viewJobCase = deriveTestReference('test/view-case.test.js', 'test/view-case.test.js', 'view job case');

function writeCase(root: string, slow: boolean): void {
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/view-case.test.js'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\n// @feature docs/feature/web/README.md\ntest('view job case', async () => { ${slow ? "await new Promise(resolve => setTimeout(resolve, 10000));" : 'assert.equal(1, 1);'} });\n`);
}

function initializedJobFixture(): string {
  const { root } = fixture();
  let repo = new LocalRepository(root, { initialize: true });
  initialize(repo, false, { testRoots: ['test'] });
  repo.close();
  repo = new LocalRepository(root);
  createDocument(repo, 'feature', { id: 'web', title: 'Web' });
  repo.close();
  writeCase(root, false);
  return root;
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('HTTP jobs run, cancel, and run again without credentials', async () => {
  const root = initializedJobFixture();
  let server: ViewServerHandle | undefined;
  try {
    writeCase(root, true);
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const current = server;
    const start = async () => {
      const response = await send(current, '/api/jobs', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ caseId: viewJobCase }) });
      assert.equal(response.status, 202, response.body);
      return (parsed(response).value as { id: string }).id;
    };
    const waitForHttp = async (id: string, states: readonly string[]) => {
      const deadline = Date.now() + 8_000;
      while (Date.now() < deadline) {
        const response = await send(current, '/api/jobs');
        assert.equal(response.status, 200, response.body);
        const job = (parsed(response).value as { id: string; state: string; evidence?: { commandOutcome: string } }[]).find(item => item.id === id);
        if (job && states.includes(job.state)) return job;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error(`HTTP job ${id} did not reach ${states.join('/')}`);
    };
    const first = await start();
    await waitForHttp(first, ['running']);
    const cancelled = await send(current, `/api/jobs/${first}`, { method: 'DELETE' });
    assert.equal(cancelled.status, 200, cancelled.body);
    await waitForHttp(first, ['cancelled']);
    writeCase(root, false);
    const second = await start();
    const completed = await waitForHttp(second, ['completed', 'failed']);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.evidence?.commandOutcome, 'pass');
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('view jobs preserve pre-spawn cancellation, serialize repository ownership, and clean shutdown', async () => {
  const root = initializedJobFixture();
  let held: LocalRepository | undefined;
  try {
    const manager = new ViewJobManager(root);
    const beforeSpawn = manager.start(viewJobCase);
    assert.equal(manager.cancel(beforeSpawn.id).state, 'cancelling');
    assert.equal((await waitFor(manager, beforeSpawn.id, ['cancelled'])).state, 'cancelled');

    const completed = manager.start(viewJobCase);
    const completedResult = await waitFor(manager, completed.id, ['completed', 'failed']);
    assert.equal(completedResult.state, 'completed', JSON.stringify(completedResult.error));
    assert.equal(completedResult.evidence?.commandOutcome, 'pass');

    held = new LocalRepository(root);
    held.beginSnapshot();
    const blocked = manager.start(viewJobCase);
    const blockedResult = await waitFor(manager, blocked.id, ['failed']);
    assert.equal(blockedResult.error?.code, 'RepositoryBusy');
    held.close();
    held = undefined;

    writeCase(root, true);
    const running = manager.start(viewJobCase);
    await waitFor(manager, running.id, ['running']);
    manager.cancel(running.id);
    assert.equal((await waitFor(manager, running.id, ['cancelled', 'cleanup-failed'])).state, 'cancelled');

    writeCase(root, false);
    const afterCancel = manager.start(viewJobCase);
    assert.equal((await waitFor(manager, afterCancel.id, ['completed', 'failed'])).state, 'completed');

    writeCase(root, true);
    const shutdown = manager.start(viewJobCase);
    await waitFor(manager, shutdown.id, ['running']);
    await manager.close();
    assert.equal((await waitFor(manager, shutdown.id, ['cancelled'])).state, 'cancelled');
    const unlocked = new LocalRepository(root);
    unlocked.close();
    assert.equal(readFileSync(join(root, 'test/view-case.test.js'), 'utf8').includes('10000'), true);
  } finally {
    held?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
