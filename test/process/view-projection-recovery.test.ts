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

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a live publication keeps the first workspace generation pending and refreshes after completion', async () => {
  const root = fixture();
  interruptPublication(root);
  const lease = acquireTraceLeaseSync(root, 'exclusive', 'projection-test-publication');
  assert.ok(lease);
  let released = false;
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const until = Date.now() + 1500;
    do {
      const response = await fetchFresh(`${base}/api/workspace`);
      const body = await response.text();
      assert.equal(response.status, 202, body);
      assert.equal(parseWorkspaceHttpResponse(response.status, body), undefined);
      await runApplication(Effect.sleep('50 millis'));
    } while (Date.now() < until);
    rmSync(join(genericPrivateDirectorySync(root), 'journal.json'));
    releaseTraceLeaseSync(lease, 'projection-test-publication-complete');
    released = true;
    const value = await waitForWorkspaceProjection(base);
    assert.equal(value.projection.status, 'ready');
    assert.equal(value.projection.lastError, undefined);
  } finally {
    await server.close();
    if (!released) releaseTraceLeaseSync(lease, 'projection-test-publication-cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('an interrupted publication blocks the first workspace generation with a named recovery error', async () => {
  const root = fixture();
  interruptPublication(root);
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const blocked = await pollUntil(async () => {
      const response = await fetchFresh(`${base}/api/workspace`);
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
    writeFileSync(join(root, 'src/main.ts'), 'export const unpublishableReplacement = 2;\n');
    const response = await fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    assert.equal(response.status, 202);
    const blocked = await pollUntil(async () => {
      const value = await waitForWorkspaceProjection(base);
      return value.projection.status === 'blocked' ? value : undefined;
    }, { description: 'blocked existing generation' });
    assert.equal(blocked.projection.lastError?.code, 'RecoveryRequired');
    assert.deepEqual(blocked.snapshot.documents, previous.snapshot.documents);
    assert.deepEqual(blocked.snapshot.pages, previous.snapshot.pages);
    assert.deepEqual(blocked.snapshot.sources, previous.snapshot.sources, 'the blocked refresh cannot replace the accepted source generation');
    const retained = await waitForWorkspaceProjection(base);
    assert.equal(retained.projection.builtAt, blocked.projection.builtAt);
    assert.deepEqual(retained.snapshot, blocked.snapshot);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a busy native cache is explicitly unavailable and recovers after its handle closes', async () => {
  const root = fixture();
  const database = openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root)), { readOnly: false, create: true });
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    try {
      const response = await fetchFresh(`${base}/api/workspace`);
      assert.equal(response.status, 503);
      const body = await response.json() as { error: string; details: { reason: string }; value?: unknown };
      assert.equal(body.error, 'WorkspaceProjectionUnavailable');
      assert.equal(body.details.reason, 'HawdbBusy');
      assert.equal(body.value, undefined);
    } finally { database.close(); }
    const recovered = await pollUntil(async () => {
      const response = await fetchFresh(`${base}/api/workspace`);
      const body = await response.text();
      return response.status === 200 ? parseWorkspaceProjection(body) : undefined;
    }, { description: 'persistent owner reopens the released cache and accepts a generation', timeoutMs: 10_000 });
    assert.equal(recovered.projection.status, 'ready');
    assert.ok(recovered.snapshot.documents.length > 0);
  } finally { database.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a running workspace serves its accepted generation while foreign cache opens are rejected', async () => {
  const root = fixture();
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const previous = await waitForWorkspaceProjection(base);
    assert.throws(() => openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root)), { readOnly: true, create: false }), { code: 'HawdbBusy' });
    const response = await fetchFresh(`${base}/api/workspace`);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    const recovered = parseWorkspaceProjection(body);
    assert.ok(recovered);
    assert.equal(recovered.projection.status, 'ready');
    assert.deepEqual(recovered.snapshot.documents, previous.snapshot.documents);
    assert.deepEqual(recovered.snapshot.sources, previous.snapshot.sources);
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('an installation missing native artifacts reports unavailable instead of pending', () => {
  const root = fixture();
  const installation = mkdtempSync(join(tmpdir(), 'concord-projection-install-'));
  try {
    writeFileSync(join(installation, 'package.json'), JSON.stringify({ private: true }));
    installConcord(installation, packConcord(installation), [], { private: true });
    const installed = join(installation, 'node_modules/concord-sdlc');
    rmSync(installationResources(installed).native, { recursive: true });
    const result = spawnSync(process.execPath, [packageBin(installed), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /^\{/u, result.stdout + result.stderr);
    const failure = JSON.parse(result.stderr) as { error: string; details: { reason: string } };
    assert.equal(failure.error, 'WorkspaceProjectionUnavailable', result.stderr);
    assert.equal(failure.details.reason, 'HawdbUnavailable');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});
