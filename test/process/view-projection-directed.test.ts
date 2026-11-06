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
