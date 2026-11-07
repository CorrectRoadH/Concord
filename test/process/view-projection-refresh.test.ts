// 跨进程保证：进程终止与信号——关闭真实View后刷新资源释放，工作区立即可由新repository handle打开。
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

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a new consistent generation with findings replaces the previous healthy generation', async () => {
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  const base = baseOf(server);
  try {
    const healthy = await waitForWorkspaceProjection(base);
    assert.deepEqual(healthy.snapshot.findings, []);
    const broken = 'docs/feature/broken/README.md';
    mkdirSync(join(root, 'docs/feature/broken'), { recursive: true });
    writeFileSync(join(root, broken), '---\nformat: concord.document/v1\nkind: feature\n---\n# Broken owner\n');
    const requested = await fetchFresh(`${base}/api/workspace`, { method: 'POST', headers: jsonHeaders, body: '{}' });
    assert.equal(requested.status, 202, await requested.text());
    const replaced = await pollUntil(async () => {
      const response = await fetchFresh(`${base}/api/workspace`);
      if (response.status !== 200) { await response.arrayBuffer(); return undefined; }
      const parsed = parseWorkspaceProjection(await response.text());
      if (parsed === undefined || parsed.snapshot.findings.length === 0) return undefined;
      return parsed;
    }, { description: 'replacement generation with findings', timeoutMs: 45_000 });
    assert.equal(replaced.projection.complete, false);
    assert.ok(replaced.snapshot.findings.some(finding => finding.path === broken), JSON.stringify(replaced.snapshot.findings));
  } finally { await server.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('closing a View server confirms scan-process cleanup and frees the worktree', async () => {
  const root = (await fixture());
  const server = await startViewServer({ root, host: '127.0.0.1', port: 0 });
  try {
    await waitForWorkspaceProjection(baseOf(server));
  } finally { await server.close(); }
  // A fresh repository handle must open immediately: the refresh lease and owned scan must be gone.
  assert.equal(existsSync(join(genericPrivateDirectorySync(root, process.env), 'workspace-refresh/current')), false);
  const reopened = (await LocalRepository.open(root));
  try { assert.ok(reopened.read('concord.config.ts')); }
  finally { reopened.close(); }
  rmSync(root, { recursive: true, force: true });
});
