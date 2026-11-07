// 跨进程保证：网络——真实HTTP投影路由返回异步刷新202、无store与ETag缓存响应，历史generation可立即读取。
import { readWorkspaceProjection, storeWorkspaceProjection } from '../support/operations.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { NodeServices } from '@effect/platform-node';
import { runApplication } from '../support/repository.ts';
import { installedConcordCli, parseWorkspaceProjectionOutput } from '../support/support.ts';
import { installationResources } from "../../src/base/installation/index.ts";
import { sourceCli } from '../support/source-consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.ts";
import { cacheDatabasePath } from "../../src/base/cache/index.ts";
import { acquireTraceLeaseSync, genericPrivateDirectorySync, releaseTraceLeaseSync } from "../../src/base/publication/index.ts";

import { openHawdb } from "../../src/base/cache/index.ts";
import { digest } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { type WorkspaceProjection } from "../../src/model/index.ts";
import { makeWorkspaceProjectionCandidate, workspaceProjectionContext as identifyProjection } from "../../src/app/index.ts";
import { type ViewServerHandle } from '../e2e/server.ts';
import { startViewServer } from '../e2e/server.ts';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.ts';

import { fixture, jsonHeaders, baseOf, interruptPublication, workspaceProjectionContext } from '../support/workspace-projection-fixture.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('GET /api/workspace serves a body-free projection and reports pending before the first generation', async () => {
  const root = (await fixture());
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
  const root = (await fixture());
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
  const root = (await fixture());
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
