// 跨进程保证：OS 锁与互斥——真实publication owner持有时首代投影保持pending，释放后服务发布；中断后保留历史generation。
import { privateSourceInstallation } from '../support/private-source.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { readWorkspaceProjection, storeWorkspaceProjection } from '../support/operations.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { NodeServices } from '@effect/platform-node';
import { runApplication } from '../support/repository.ts';
import { installedConcordCli, parseWorkspaceProjectionOutput } from '../support/support.ts';
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
import { type ViewServerHandle } from '../support/view-server.ts';
import { startViewServer } from '../support/view-server.ts';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.ts';

import { fixture, jsonHeaders, baseOf, interruptPublication, workspaceProjectionContext } from '../support/workspace-projection-fixture.ts';
import { hawdbTarget } from '../../src/base/installation/index.ts';
import { installationResources } from '../support/source-resources.ts';
import { sourceCli, prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a live publication keeps the first workspace generation pending and refreshes after completion', async () => {
  const root = (await fixture());
  (await interruptPublication(root));
  const lease = acquireTraceLeaseSync(root, 'exclusive', 'projection-test-publication', undefined, undefined, process.env);
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
    rmSync(join(genericPrivateDirectorySync(root, process.env), 'journal.json'));
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
  const root = (await fixture());
  (await interruptPublication(root));
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
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const previous = await waitForWorkspaceProjection(base);
    (await interruptPublication(root));
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
