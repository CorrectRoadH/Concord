// 跨进程保证：原生模块与句柄——真实native handle与服务owner双向互斥，释放后服务恢复，server stop确认释放后可独立重开写入。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
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
import { hawdbLibraryName, hawdbTarget } from '../../src/base/installation/index.ts';
import { installationResources } from '../support/source-resources.ts';
import { sourceCli, prepareSourceConsumer, sourceRoot } from '../support/source-consumer.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a busy native cache is explicitly unavailable and recovers after its handle closes', async () => {
  const root = (await fixture());
  const database = openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root, process.env)), { readOnly: false, create: true }, nativeRuntime);
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    try {
      const response = await pollUntil(async () => {
        const current = await fetchFresh(`${base}/api/workspace`);
        if (current.status === 202) { await current.text(); return undefined; }
        return current;
      }, { description: 'native cache opening completes with its unavailable state' });
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
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const previous = await waitForWorkspaceProjection(base);
    assert.throws(() => openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root, process.env)), { readOnly: true, create: false }, nativeRuntime), { code: 'HawdbBusy' });
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
test('an installation missing native artifacts reports unavailable instead of pending', async () => {
  const root = (await fixture());
  const installation = mkdtempSync(join(tmpdir(), 'concord-projection-install-'));
  try {
    privateSourceInstallation(installation);
    const installed = installation;
    rmSync(join(installationResources(installed).native, hawdbTarget(), hawdbLibraryName(hawdbTarget())));
    const result = spawnSync(process.execPath, [sourceCli(installed), '--root', root, '--json', 'workspace', 'projection'], { env: { ...process.env, XDG_CACHE_HOME: join(installation, '.test-cache') }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /^\{/u, result.stdout + result.stderr);
    const failure = JSON.parse(result.stderr) as { error: string; details: { reason: string } };
    assert.equal(failure.error, 'WorkspaceProjectionUnavailable', result.stderr);
    assert.equal(failure.details.reason, 'HawdbUnavailable');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(installation, { recursive: true, force: true }); }
});

// @feature docs/feature/local-data-engine/README.md
test('server stop returns only after persistent ownership and the instance record are released', async () => {
  const root = (await fixture());
  try {
    const started = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'server', 'start'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(started.status, 0, started.stdout + started.stderr);
    const ready = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'list'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    stopWorkspaceServer(root);
    const database = openHawdb(cacheDatabasePath(genericPrivateDirectorySync(root, process.env)), { readOnly: false, create: false }, nativeRuntime);
    try { database.put('query_cache', [{ key: 'released-owner', payload: '{}' }]); }
    finally { database.close(); }
  } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
});
