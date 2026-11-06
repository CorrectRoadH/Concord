import { Publication } from '../../src/base/publication/index.js';
import { createDocument, initialize } from '../support/operations.js';
import { runApplication } from '../support/repository.js';
import { openWriteRepository } from '../../src/base/workspace/index.js';
import { Sources } from '../../src/base/sources/index.js';
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.js";
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

import { LocalRepository } from "../support/repository.js";

import { ViewJobManager } from "../../src/app/index.js";
import { formatViewAddress } from "../../src/entry/http/index.js";
import { startViewServer, type ViewServerHandle } from '../e2e/server.js';
import { parseWorkspaceProjection, pollUntil, installedConcordCli } from '../support/support.js';
import { type WorkspaceProjection } from "../../src/model/index.js";

import { fixture, send, sendRaw, parsed, jsonHeaders, waitForWorkspace } from '../support/view-http-fixture.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
// @name workspace-scan-keeps-http-responsive
test('a real thousand-file workspace scan leaves static and document HTTP requests responsive', async t => {
  const f = fixture();
  const repo = new LocalRepository(f.root, { initialize: true });
  try { initialize(repo, false, { testRoots: ['test'], sourceRoots: ['src'] }); }
  finally { repo.close(); }
  mkdirSync(join(f.root, 'src'), { recursive: true });
  mkdirSync(join(f.root, 'test'), { recursive: true });
  for (let index = 0; index < 1072; index++) {
    writeFileSync(join(f.root, 'src', `source-${index}.ts`), `export const value${index} = ${index};\n`);
    writeFileSync(join(f.root, 'test', `test-${index}.ts`), `export const value${index} = ${index};\n`);
  }
  const server = await startViewServer({ ...f, host: '127.0.0.1', port: 0 });
  try {
    const started = performance.now();
    const cold = await send(server, '/api/workspace');
    assert.equal(cold.status, 202, cold.body);
    const lease = join(f.root, '.git/concord/trace/publication.lease');
    assert.equal(existsSync(lease), false, 'source scanning does not acquire publication ownership');
    const responsiveAt = performance.now();
    const shell = await send(server, '/');
    const script = /src="([^"]+\.js)"/u.exec(shell.body)?.[1];
    assert.ok(script, shell.body);
    const [asset, document] = await Promise.all([send(server, script), send(server, '/api/file?path=docs%2Ftaste.md')]);
    assert.equal(asset.status, 200, asset.body);
    assert.equal(document.status, 200, document.body);
    const responseMs = performance.now() - responsiveAt;
    const ready = await waitForWorkspace(server);
    const coldMs = performance.now() - started;
    assert.ok(ready.snapshot.pages.some(page => page.path === 'docs/taste.md'));
    const second = await send(server, '/api/workspace');
    assert.equal(second.status, 200, second.body);
    t.diagnostic(`1072 source + 1072 test files: concurrent response ${Math.round(responseMs)}ms; cold workspace ${Math.round(coldMs)}ms`);
  } finally { await server.close(); rmSync(f.root, { recursive: true, force: true }); }
});

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
  const { root } = fixture();
  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    const shell = await send(server, '/workspace/deep-link');
    assert.equal(shell.status, 200);
    assert.match(shell.body, /<div id="root"><\/div>/u);
    assert.equal(shell.body.includes(root), false, 'the application shell contains no consumer path');
    assert.match(shell.type ?? '', /^text\/html/u);

    const customAuthority = `concord.example.test:${server.port}`;
    const customShell = await send(server, '/workspace/from-proxy', { headers: { host: customAuthority } });
    assert.equal(customShell.status, 200);
    const openAccess = await send(server, '/api/workspace', { headers: { host: customAuthority } });
    assert.ok([200, 202].includes(openAccess.status), openAccess.body);
    const httpSameOrigin = await send(server, '/api/workspace', { headers: { host: customAuthority, origin: `http://${customAuthority}` } });
    assert.ok([200, 202].includes(httpSameOrigin.status), httpSameOrigin.body);
    const httpsDefaultPort = await send(server, '/api/workspace', { headers: { host: 'concord.example.test:443', origin: 'https://concord.example.test' } });
    assert.ok([200, 202].includes(httpsDefaultPort.status), httpsDefaultPort.body);
    const explicitOriginDefaultPort = await send(server, '/api/workspace', { headers: { host: 'concord.example.test', origin: 'https://concord.example.test:443' } });
    assert.ok([200, 202].includes(explicitOriginDefaultPort.status), explicitOriginDefaultPort.body);
    const natAuthority = '192.0.2.44:7443';
    const nat = await send(server, '/api/workspace', { headers: { host: natAuthority, origin: `https://${natAuthority}` } });
    assert.ok([200, 202].includes(nat.status), nat.body);
    const ipv6Authority = '[2001:db8::1]:7443';
    const ipv6 = await send(server, '/api/workspace', { headers: { host: ipv6Authority, origin: `https://${ipv6Authority}` } });
    assert.ok([200, 202].includes(ipv6.status), ipv6.body);
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

    const empty = await waitForWorkspace(server);
    assert.deepEqual(empty.snapshot.project, { testRoots: [], sourceRoots: [] });
    assert.equal(empty.snapshot.root, root);

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
    for (const [id, kind, pages] of [['unknown-page', 'feature', ['other']], ['duplicate-page', 'feature', ['cli', 'cli']], ['engineering-pages', 'engineering', ['other']]] as const) {
      const invalid = await send(server, '/api/action', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ action: 'document.create', kind, id, title: id, pages }) });
      assert.equal(invalid.status, 400, invalid.body);
      assert.equal(existsSync(join(root, `docs/${kind}/${id}`)), false);
    }
    const workspace = await waitForWorkspace(server, 65_000, value => value.snapshot.documents.some(document => document.path === 'docs/feature/web/README.md'));
    assert.equal(workspace.snapshot.documents.length, 1);
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
  const { root } = fixture();
  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
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
  const cli = installedConcordCli();
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
    const cache = join(root, '.git/concord/cache.hawdb');
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
test('workspace diagnostics never dereference unsafe configuration paths', async () => {
  const { root } = fixture();
  const outside = mkdtempSync(join(tmpdir(), 'concord-view-outside-'));
  let server: ViewServerHandle | undefined;
  try {
    const secret = 'must-not-cross-the-worktree-boundary';
    writeFileSync(join(outside, 'secret.json'), secret);
    symlinkSync(join(outside, 'secret.json'), join(root, 'concord.config.ts'));
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    // A linked config is a path-safety failure: the target must never be dereferenced
    // or served, whatever failure surface the refresh chooses.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const linked = await send(server, '/api/workspace');
      assert.equal(linked.body.includes(secret), false, 'a linked configuration must never expose its target');
    }

    rmSync(join(root, 'concord.config.ts'));
    // A readable but invalid configuration still yields a diagnosable projection bound to its raw bytes.
    writeFileSync(join(root, 'concord.config.ts'), 'export default { nope: true };\n');
    const invalid = await waitForWorkspace(server);
    const invalidValue = invalid.snapshot as unknown as { configDigest: string | null; diagnostics?: { error?: string } };
    assert.equal(typeof invalidValue.configDigest, 'string');
    assert.ok(invalidValue.diagnostics?.error, 'invalid configuration is reported by name instead of blocking navigation');
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }


});

const viewJobCase = deriveTestReference('test/view-case.test.js', 'test/view-case.test.js', caseDiscriminator('docs/feature/web/README.md', 0));

function writeCase(root: string, slow: boolean): void {
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/view-case.test.js'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\n// @feature docs/feature/web/README.md\ntest('view job case', async () => { ${slow ? "await new Promise(resolve => setTimeout(resolve, 10000));" : 'assert.equal(1, 1);'} });\n`);
}

function initializedJobFixture(): string {
  const { root } = fixture();
  let repo = new LocalRepository(root, { initialize: true });
  initialize(repo, false, { testRoots: ['test'], runner: { kind: 'command', argv: [process.execPath, '--test', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
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
    assert.equal(completed.evidence?.commandOutcome, 'pass', JSON.stringify(completed));
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
    const manager = new ViewJobManager(root, () => {}, (selected, use) => runApplication(Effect.scoped(Effect.gen(function*() {
      const sources = yield* Sources;
      const publication = yield* Publication;
      const repo = yield* openWriteRepository(selected);
      return yield* Effect.tryPromise({ try: () => use(repo, sources, publication), catch: cause => cause });
    }))));
    const beforeSpawn = manager.start(viewJobCase);
    assert.equal(manager.cancel(beforeSpawn.id).state, 'cancelling');
    assert.equal((await waitFor(manager, beforeSpawn.id, ['cancelled'])).state, 'cancelled');

    const completed = manager.start(viewJobCase);
    const completedResult = await waitFor(manager, completed.id, ['completed', 'failed']);
    assert.equal(completedResult.state, 'completed', JSON.stringify(completedResult.error));
    assert.equal(completedResult.evidence?.commandOutcome, 'pass', JSON.stringify(completedResult));

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
