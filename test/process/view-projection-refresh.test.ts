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
import { prepareSourceConsumer, sourceConcord } from '../support/installed-package.js';
import { parseWorkspaceHttpResponse, parseWorkspaceProjection, pollUntil, waitForWorkspaceNotModified, waitForWorkspaceProjection, fetchFresh } from '../support/support.js';

import { fixture, jsonHeaders, baseOf, interruptPublication, workspaceProjectionContext } from '../support/workspace-projection-fixture.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a new consistent generation with findings replaces the previous healthy generation', async () => {
  const root = fixture();
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
