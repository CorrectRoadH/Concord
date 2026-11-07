// 跨进程保证：原生模块与句柄——真实native query命名空间预算压力不驱逐workspace行，后续CLI读取保留同代投影。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
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
import { type ViewServerHandle } from '../support/view-server.ts';
import { startViewServer } from '../support/view-server.ts';
import { prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.ts';

import { fixture, jsonHeaders, baseOf, interruptPublication, workspaceProjectionContext } from '../support/workspace-projection-fixture.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('workspace projection survives query-cache eviction pressure in its own namespace', async () => {
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try { await waitForWorkspaceProjection(baseOf(server)); }
  finally { await server.close(); }
  // Shutdown can finish an already queued refresh; freeze the durable generation
  // before applying query-cache pressure.
  const built = parseWorkspaceProjectionOutput(execFileSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8' }));
  const path = cacheDatabasePath(genericPrivateDirectorySync(root, process.env));
  const database = openHawdb(path, { readOnly: false, create: false }, nativeRuntime);
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
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try { await waitForWorkspaceProjection(baseOf(server)); }
  finally { await server.close(); }
  const path = cacheDatabasePath(genericPrivateDirectorySync(root, process.env));
  const database = openHawdb(path, { readOnly: false, create: false }, nativeRuntime);
  try { database.put('workspace_projection', [{ key: 'workspace', payload: 'corrupt-not-json{' }]); }
  finally { database.close(); }
  (await assert.rejects(async () => readWorkspaceProjection((await workspaceProjectionContext(root))), { code: 'WorkspaceProjectionUnavailable' }));
  // The current-source entry point still works; unavailability never authorizes a scan to satisfy navigation.
  assert.ok((await runApplication(getWorkspaceSnapshot(root, 'off'))).documents.length > 0);
  rmSync(root, { recursive: true, force: true });
});
