import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { cacheDatabasePath } from '../dist/cache-file.js';
import { genericPrivateDirectorySync } from '../dist/coordination.js';
import { createDocument } from '../dist/documents.js';
import { openHawdb } from '../dist/hawdb-native.js';
import { digest } from '../dist/shared.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import type { WorkspaceProjection } from '../dist/view-contract.js';
import { makeWorkspaceProjectionRecord, readWorkspaceProjection, storeWorkspaceProjection, workspaceProjectionContext } from '../dist/workspace-projection.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, parseWorkspaceProjectionOutput, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection } from './support.js';

const cli = join(resolve('.'), 'dist/entry.js');

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-projection-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [], sourceRoots: ['src'] });
    createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const projectedValue = 1;\n');
  return root;
}

const jsonHeaders = { 'content-type': 'application/json' };
const baseOf = (server: ViewServerHandle): string => `http://127.0.0.1:${server.port}`;

function interruptPublication(root: string): void {
  const repo = new LocalRepository(root);
  try {
    const path = 'docs/architecture.md';
    const before = repo.read(path)!;
    const after = before + '\nInterrupted\n';
    writeFileSync(join(repo.privateDir, 'journal.json'), JSON.stringify({ format: 'concord.journal', root, privateDir: repo.privateDir,
      projectId: repo.config.projectId, operation: 'outlines', phase: 'prepared', directories: [],
      scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
      changes: [{ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 420 }] }));
  } finally { repo.close(); }
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('GET /api/workspace serves a body-free projection and reports pending before the first generation', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const first = await fetch(`${base}/api/workspace`);
    const firstBody = await first.text();
    const initial = parseWorkspaceHttpResponse(first.status, firstBody);
    if (first.status === 200) assert.ok(initial, 'a ready response contains the complete projection envelope');
    else assert.equal(initial, undefined, 'the first build is a pending response');
    const value = await waitForWorkspaceProjection(base);
    assert.equal(value.projection.status, 'ready');
    assert.equal(value.projection.current, false);
    assert.equal(value.projection.consistent, true);
    assert.deepEqual(value.projection.changedPaths, []);
    assert.equal(value.projection.unknownRelations, false);
    assert.ok(Number.isFinite(Date.parse(value.projection.builtAt)));
    assert.ok(Number.isFinite(Date.parse(value.projection.builtFrom)));
    assert.ok(Number.isFinite(Date.parse(value.projection.builtUntil)));
    assert.equal(value.snapshot.root, root);
    assert.ok(value.snapshot.documents.some(document => document.metadata.id === 'projected'));
    // Owner bodies never enter the durable projection; detail reads are directed.
    for (const document of value.snapshot.documents) assert.equal('body' in document, false);
    for (const page of value.snapshot.pages) assert.equal('body' in page, false);
    const response = await fetch(`${base}/api/workspace`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('POST /api/workspace requests one merged refresh without waiting for the scan', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    await waitForWorkspaceProjection(base);
    const requested = await fetch(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    const requestedBody = await requested.text();
    assert.equal(requested.status, 202, requestedBody);
    assert.deepEqual(JSON.parse(requestedBody), { ok: true, value: { status: 'requested' } });
    // Host/Origin and strict JSON keep applying to the retry route.
    const excess = await fetch(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ extra: true }) });
    assert.equal(excess.status, 400);
    assert.equal((await excess.json() as { readonly error: string }).error, 'InvalidData');
    const missingType = await fetch(`${base}/api/workspace`, { method: 'POST', body: '{}' });
    assert.equal(missingType.status, 400);
    const malformed = await fetch(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: 'not json' });
    assert.equal(malformed.status, 400);
    // A plain GET still reads the cached generation immediately.
    const immediate = await fetch(`${base}/api/workspace`);
    const immediateBody = await immediate.text();
    assert.equal(immediate.status, 200, immediateBody);
    assert.ok(parseWorkspaceProjection(immediateBody));
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workspace ETag reuses the published generation and only 304s while the cache stays readable', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    await waitForWorkspaceProjection(base);
    const etag = await waitForWorkspaceNotModified(base);
    // Polling is throttled, so a source edit does not silently swap the published generation.
    writeFileSync(join(root, 'src/main.ts'), 'export const projectedValue = 2;\n');
    assert.equal(await waitForWorkspaceNotModified(base), etag, 'navigation returns the last readable generation until a refresh replaces it');
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('/api/file resolves directed current owners without a workspace-wide scan', async () => {
  const root = fixture();
  const seed = new LocalRepository(root);
  try { createDocument(seed, 'issue', { id: 'sample-issue', title: 'Sample issue' }); }
  finally { seed.close(); }
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const document = await fetch(`${base}/api/file?path=${encodeURIComponent('docs/feature/projected/README.md')}`);
    assert.equal(document.status, 200, await document.clone().text());
    const documentValue = await document.json() as { readonly value: { readonly body: string; readonly digest: string; readonly document?: { readonly metadata: { readonly id: string } } } };
    assert.equal(documentValue.value.document?.metadata.id, 'projected');
    assert.match(documentValue.value.body, /Projected feature/u);

    const config = await fetch(`${base}/api/file?path=${encodeURIComponent('concord.config.ts')}`);
    assert.equal(config.status, 200, await config.clone().text());
    const configValue = await config.json() as { readonly value: { readonly project?: { readonly projectId: string }; readonly digest: string } };
    assert.ok(configValue.value.project, 'a valid config target exposes its parsed project preimage');

    const issue = await fetch(`${base}/api/file?path=${encodeURIComponent('docs/issues/sample-issue.md')}`);
    assert.equal(issue.status, 200, await issue.clone().text());
    const issueValue = await issue.json() as { readonly value: { readonly feedback?: { readonly document: { readonly metadata: { readonly kind: string; readonly id: string } }; readonly remote: unknown } } };
    assert.equal(issueValue.value.feedback?.document.metadata.kind, 'issue');
    assert.equal(issueValue.value.feedback?.document.metadata.id, 'sample-issue');
    assert.equal(issueValue.value.feedback?.remote, null);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workspace show keeps current-source semantics while workspace projection reads the shared cache', async () => {
  const root = fixture();
  const show = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'show'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(show.status, 0, show.stderr);
  const shown = JSON.parse(show.stdout) as Record<string, unknown>;
  assert.equal(shown.root, root);
  assert.ok(Array.isArray(shown.documents));
  assert.equal('snapshot' in shown, false);
  assert.equal('projection' in shown, false);

  // No View server has ever published here, so the explicit cache entry reports pending instead of scanning.
  const pending = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(pending.status, 1, pending.stdout + pending.stderr);
  assert.equal((JSON.parse(pending.stderr) as { readonly error: string }).error, 'WorkspaceProjectionPending');

  let server: ViewServerHandle | undefined;
  try {
    server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    await waitForWorkspaceProjection(baseOf(server));
  } finally { await server?.close(); }
  const projection = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(projection.status, 0, projection.stdout + projection.stderr);
  const cached = parseWorkspaceProjectionOutput(projection.stdout);
  assert.equal(cached.operation, 'workspace-projection');
  assert.equal(cached.projection.refreshOwner, 'none', 'the explicit CLI entry never starts a refresh');
  assert.equal(cached.projection.status, 'ready');
  assert.ok(cached.snapshot.documents.some(document => document.metadata.id === 'projected'));
  rmSync(root, { recursive: true, force: true });
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('workspace projection survives query-cache eviction pressure in its own namespace', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  let built: WorkspaceProjection;
  try { built = await waitForWorkspaceProjection(baseOf(server)); }
  finally { await server.close(); }
  const path = cacheDatabasePath(genericPrivateDirectorySync(root));
  const database = openHawdb(path, { readOnly: false, create: false });
  try {
    for (let index = 0; index < 64; index++) {
      try {
        database.put('query_cache', [{ key: `trace/gaps/${index}`, payload: JSON.stringify({ format: 'concord.query-cache/v2', key: `trace/gaps/${index}`, record: { builtAt: new Date().toISOString(), scannedAt: index, value: { index } } }) }], { maxEntries: 4, maxBytes: 8 * 1024 });
      } catch { /* The bounded query namespace may reject the batch; the workspace row must still survive. */ }
    }
    const rows = database.get('workspace_projection', ['workspace']);
    assert.equal(rows.length, 1, 'query-cache pressure must not evict the workspace row');
  } finally { database.close(); }
  const projection = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(projection.status, 0, projection.stdout + projection.stderr);
  const cached = parseWorkspaceProjectionOutput(projection.stdout);
  assert.equal(cached.projection.builtAt, built.projection.builtAt, 'query traffic cannot silently rebuild the workspace generation');
  rmSync(root, { recursive: true, force: true });
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a corrupt workspace row is reported unavailable without falling back to a source scan', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try { await waitForWorkspaceProjection(baseOf(server)); }
  finally { await server.close(); }
  const path = cacheDatabasePath(genericPrivateDirectorySync(root));
  const database = openHawdb(path, { readOnly: false, create: false });
  try { database.put('workspace_projection', [{ key: 'workspace', payload: 'corrupt-not-json{' }]); }
  finally { database.close(); }
  const projection = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(projection.status, 1, projection.stdout + projection.stderr);
  assert.equal((JSON.parse(projection.stderr) as { readonly error: string }).error, 'WorkspaceProjectionUnavailable');
  // The current-source entry point still works; unavailability never authorizes a scan to satisfy navigation.
  const show = spawnSync(process.execPath, [cli, '--root', root, '--json', 'workspace', 'show'], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(show.status, 0, show.stderr);
  assert.ok((JSON.parse(show.stdout) as { readonly documents: unknown[] }).documents.length > 0);
  rmSync(root, { recursive: true, force: true });
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('an interrupted publication blocks the first workspace generation with a named recovery error', async () => {
  const root = fixture();
  interruptPublication(root);
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const blocked = await pollUntil(async () => {
      const response = await fetch(`${base}/api/workspace`);
      const body = await response.text();
      return response.status === 503 && body.includes('RecoveryRequired') ? body : undefined;
    }, { description: 'RecoveryRequired workspace response', timeoutMs: 45_000 });
    assert.match(blocked, /RecoveryRequired/u);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('an interrupted publication retains a prior generation with blocked status', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const previous = await waitForWorkspaceProjection(base);
    interruptPublication(root);
    const response = await fetch(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    assert.equal(response.status, 202);
    const blocked = await pollUntil(async () => {
      const value = await waitForWorkspaceProjection(base);
      return value.projection.status === 'blocked' ? value : undefined;
    }, { description: 'blocked existing generation' });
    assert.equal(blocked.projection.builtAt, previous.projection.builtAt);
    assert.equal(blocked.projection.lastError?.code, 'RecoveryRequired');
    assert.deepEqual(blocked.snapshot, previous.snapshot);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a busy native cache is explicitly unavailable and recovers after its handle closes', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const previous = await waitForWorkspaceProjection(base);
    const database = openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root)), { readOnly: true, create: false });
    try {
      const response = await fetch(`${base}/api/workspace`);
      assert.equal(response.status, 503);
      const body = await response.json() as { error: string; details: { reason: string }; value?: unknown };
      assert.equal(body.error, 'WorkspaceProjectionUnavailable');
      assert.equal(body.details.reason, 'HawdbBusy');
      assert.equal(body.value, undefined);
    } finally { database.close(); }
    const recovered = await waitForWorkspaceProjection(base);
    assert.equal(recovered.projection.builtAt, previous.projection.builtAt);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('an installation missing native artifacts reports unavailable instead of pending', () => {
  const root = fixture();
  const installation = mkdtempSync(join(tmpdir(), 'concord-projection-install-'));
  try {
    cpSync(resolve('package.json'), join(installation, 'package.json'));
    cpSync(resolve('dist'), join(installation, 'dist'), { recursive: true, filter: path => path !== resolve('dist/native') });
    symlinkSync(resolve('node_modules'), join(installation, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, [join(installation, 'dist/entry.js'), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stderr) as { error: string; details: { reason: string } };
    assert.equal(failure.error, 'WorkspaceProjectionUnavailable', result.stderr);
    assert.equal(failure.details.reason, 'HawdbUnavailable');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a first generation built during source drift publishes incomplete navigation instead of failing', async () => {
  const root = fixture();
  const sources = Array.from({ length: 900 }, (_value, index) => `src/source-${index}.ts`);
  for (const path of sources) writeFileSync(join(root, path), 'export const value = 0;\n');
  let revision = 0;
  const churn = setInterval(() => {
    const path = sources[revision % sources.length]!;
    writeFileSync(join(root, path), `export const value = ${revision += 1};\n`);
  }, 2);
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const first = await fetch(`${base}/api/workspace`);
    await first.arrayBuffer();
    const value = await pollUntil(async () => {
      const response = await fetch(`${base}/api/workspace`);
      if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
      const parsed = parseWorkspaceProjection(await response.text());
      return parsed?.projection.consistent === false ? parsed : undefined;
    }, { description: 'drifted first generation', timeoutMs: 50_000 });
    assert.equal(value.projection.status, 'ready');
    assert.equal(value.projection.consistent, false);
    assert.equal(value.projection.complete, false);
    assert.equal(value.projection.unknownRelations, true);
    assert.ok(value.projection.changedPaths.length > 0, 'a drifted generation lists what changed');
  } finally {
    clearInterval(churn);
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a new consistent generation with findings replaces the previous healthy generation', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const healthy = await waitForWorkspaceProjection(base);
    assert.equal(healthy.projection.consistent, true);
    assert.deepEqual(healthy.snapshot.findings, []);
    const broken = 'docs/feature/broken/README.md';
    mkdirSync(join(root, 'docs/feature/broken'), { recursive: true });
    writeFileSync(join(root, broken), '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken owner\n');
    const requested = await fetch(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    assert.equal(requested.status, 202, await requested.text());
    const replaced = await pollUntil(async () => {
      const response = await fetch(`${base}/api/workspace`);
      if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
      const parsed = parseWorkspaceProjection(await response.text());
      if (parsed === undefined || parsed.snapshot.findings.length === 0) return undefined;
      return parsed;
    }, { description: 'replacement generation with findings', timeoutMs: 45_000 });
    assert.equal(replaced.projection.consistent, true);
    assert.equal(replaced.projection.complete, false);
    assert.ok(replaced.snapshot.findings.some(finding => finding.path === broken), JSON.stringify(replaced.snapshot.findings));
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a drifted candidate retains the last consistent generation and reports the attempt without failing', async () => {
  const root = fixture();
  const snapshot = await Effect.runPromise(getWorkspaceSnapshot(root, 'off'));
  const context = workspaceProjectionContext(root);
  try {
    storeWorkspaceProjection(context, makeWorkspaceProjectionRecord(snapshot, { files: [], directories: [], publicationChanged: false }, new Date(Date.now() - 1000).toISOString()));
    const healthy = readWorkspaceProjection(context);
    assert.equal(healthy.projection.status, 'ready');
    storeWorkspaceProjection(context, makeWorkspaceProjectionRecord(snapshot, { files: ['src/main.ts'], directories: [], publicationChanged: false }, new Date().toISOString()));
    const retained = readWorkspaceProjection(context);
    assert.equal(retained.projection.status, 'ready', 'source drift during editing is not a refresh failure');
    assert.equal(retained.projection.consistent, true, 'the last consistent generation stays the navigation result');
    assert.deepEqual(retained.projection.changedPaths, []);
    assert.equal(retained.projection.lastError, undefined);
    assert.deepEqual(retained.projection.lastAttempt?.changedPaths, ['src/main.ts']);
    assert.equal(retained.projection.lastAttempt?.complete, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('observeProjection reports observed file drift without throwing the candidate away', () => {
  const root = fixture();
  const repo = new LocalRepository(root, { optimistic: true, access: 'read' });
  try {
    const target = 'docs/feature/projected/README.md';
    const original = readFileSync(join(root, target), 'utf8');
    const result = repo.observeProjection(() => {
      assert.equal(repo.read(target), original);
      writeFileSync(join(root, target), `${original}\nDrifted after read.\n`);
      return { ok: true as const };
    });
    assert.equal(result.value.ok, true, 'file drift does not throw the candidate away');
    assert.deepEqual(result.drift.files, [target]);
    assert.deepEqual(result.drift.directories, []);
    assert.equal(result.drift.publicationChanged, false);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('closing a View server confirms scan-process cleanup and frees the worktree', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    await waitForWorkspaceProjection(baseOf(server));
  } finally { await server.close(); }
  // A fresh repository handle must open immediately: the refresh lease and owned scan must be gone.
  assert.equal(existsSync(join(genericPrivateDirectorySync(root), 'workspace-refresh/current')), false);
  const reopened = new LocalRepository(root);
  try { assert.ok(reopened.read('concord.config.ts')); }
  finally { reopened.close(); }
  rmSync(root, { recursive: true, force: true });
});
