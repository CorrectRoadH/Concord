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
