import { readWorkspaceProjection, storeWorkspaceProjection } from '../support/operations.js';
import { createDocument, initialize } from '../support/operations.js';
import { Workspace } from '../../src/base/workspace/index.js';
import { NodeServices } from '@effect/platform-node';
import { runApplication } from '../support/repository.js';
import { installedConcordCli, parseWorkspaceProjectionOutput } from '../support/support.js';
import { installationResources } from "../../src/base/installation/index.js";
import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.js";
import { cacheDatabasePath } from "../../src/base/cache/index.js";
import { acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync } from "../../src/base/publication/index.js";

import { openHawdb } from "../../src/base/cache/index.js";
import { digest } from "../../src/model/index.js";
import { LocalRepository } from "../support/repository.js";

import { type WorkspaceProjection } from "../../src/model/index.js";
import { makeWorkspaceProjectionCandidate, workspaceProjectionContext as identifyProjection } from "../../src/app/index.js";
import { type ViewServerHandle } from '../e2e/server.js';
import { startViewServer } from '../e2e/server.js';
import { installConcord, packConcord } from '../support/installed-package.js';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.js';

import { fixture, jsonHeaders, baseOf, interruptPublication, workspaceProjectionContext } from '../support/workspace-projection-fixture.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('GET /api/workspace serves a body-free projection and reports pending before the first generation', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const first = await fetchFresh(`${base}/api/workspace`);
    const firstBody = await first.text();
    const initial = parseWorkspaceHttpResponse(first.status, firstBody);
    if (first.status === 200) assert.ok(initial, 'a ready response contains the complete projection envelope');
    else assert.equal(initial, undefined, 'the first build is a pending response');
    const value = await waitForWorkspaceProjection(base);
    assert.equal(value.projection.status, 'ready');
    assert.equal(value.projection.current, false);
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
    const response = await fetchFresh(`${base}/api/workspace`);
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
    const requested = await fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    const requestedBody = await requested.text();
    assert.equal(requested.status, 202, requestedBody);
    assert.deepEqual(JSON.parse(requestedBody), { ok: true, value: { status: 'requested' } });
    // Host/Origin and strict JSON keep applying to the retry route.
    const excess = await fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ extra: true }) });
    assert.equal(excess.status, 400);
    assert.equal((await excess.json() as { readonly error: string }).error, 'InvalidData');
    const missingType = await fetchFresh(`${base}/api/workspace`, { method: 'POST', body: '{}' });
    assert.equal(missingType.status, 400);
    const malformed = await fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: 'not json' });
    assert.equal(malformed.status, 400);
    // A plain GET still reads the cached generation immediately.
    const immediate = await fetchFresh(`${base}/api/workspace`);
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
    const document = await fetchFresh(`${base}/api/file?path=${encodeURIComponent('docs/feature/projected/README.md')}`);
    assert.equal(document.status, 200, await document.clone().text());
    const documentValue = await document.json() as { readonly value: { readonly body: string; readonly digest: string; readonly document?: { readonly metadata: { readonly id: string } } } };
    assert.equal(documentValue.value.document?.metadata.id, 'projected');
    assert.match(documentValue.value.body, /Projected feature/u);

    const config = await fetchFresh(`${base}/api/file?path=${encodeURIComponent('concord.config.ts')}`);
    assert.equal(config.status, 200, await config.clone().text());
    const configValue = await config.json() as { readonly value: { readonly project?: { readonly sourceRoots?: readonly string[] }; readonly digest: string } };
    assert.ok(configValue.value.project, 'a valid config target exposes its parsed project preimage');

    const issue = await fetchFresh(`${base}/api/file?path=${encodeURIComponent('docs/issues/sample-issue.md')}`);
    assert.equal(issue.status, 200, await issue.clone().text());
    const issueValue = await issue.json() as { readonly value: { readonly feedback?: { readonly document: { readonly metadata: { readonly kind: string; readonly id: string } }; readonly remote: unknown } } };
    assert.equal(issueValue.value.feedback?.document.metadata.kind, 'issue');
    assert.equal(issueValue.value.feedback?.document.metadata.id, 'sample-issue');
    assert.equal(issueValue.value.feedback?.remote, null);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('current-source queries and cached projection queries remain separate', async () => {
  const root = fixture();
  try {
    const shown = await runApplication(getWorkspaceSnapshot(root, 'off'));
    assert.equal(shown.root, root);
    assert.ok(shown.documents.length > 0);
    assert.equal('projection' in shown, false);
    assert.throws(() => readWorkspaceProjection(workspaceProjectionContext(root)), { code: 'WorkspaceProjectionPending' });
    const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
    try { await waitForWorkspaceProjection(baseOf(server)); } finally { await server.close(); }
    const cached = parseWorkspaceProjectionOutput(execFileSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8' }));
    assert.equal(cached.projection.refreshOwner, 'none');
    assert.equal(cached.projection.status, 'ready');
    assert.ok(cached.snapshot.documents.some(document => document.metadata.id === 'projected'));
  } finally { rmSync(root, { recursive: true, force: true }); }
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
  const cached = parseWorkspaceProjectionOutput(execFileSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8' }));
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
  assert.throws(() => readWorkspaceProjection(workspaceProjectionContext(root)), { code: 'WorkspaceProjectionUnavailable' });
  // The current-source entry point still works; unavailability never authorizes a scan to satisfy navigation.
  assert.ok((await runApplication(getWorkspaceSnapshot(root, 'off'))).documents.length > 0);
  rmSync(root, { recursive: true, force: true });
});
