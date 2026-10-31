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
import { PersistentCache } from '../../src/base/cache/index.js';
import { ConcordError } from '../../src/model/index.js';
import { storeWorkspaceProjection as publishProjection, readWorkspaceProjection as readPublishedProjection } from '../../src/app/index.js';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a completed workspace scan survives brief contention at publication', async () => {
  const root = fixture();
  try {
    const snapshot = await runApplication(getWorkspaceSnapshot(root, 'off'));
    const candidate = makeWorkspaceProjectionCandidate(snapshot, { files: [], directories: [], publicationChanged: false }, new Date().toISOString(), 'fixture-sources');
    const context = workspaceProjectionContext(root);
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* PersistentCache.owner(context.privateDir);
      yield* owner.open;
      assert.throws(() => openHawdb(cacheDatabasePath(context.privateDir), { readOnly: false, create: true }), { code: 'HawdbBusy' });
      let writes = 0;
      const service = { ...owner.service, update: (...args: Parameters<typeof owner.service.update>) => { writes++; return owner.service.update(...args); } };
      yield* publishProjection(context, candidate).pipe(Effect.provideService(PersistentCache, service));
      const published = yield* readPublishedProjection(context).pipe(Effect.provideService(PersistentCache, owner.service));
      assert.equal(published.projection.builtAt, candidate.builtAt);
      assert.equal(writes, 1, 'the persistent owner publishes the completed candidate exactly once');
    })).pipe(Effect.provide(PersistentCache.layer)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a recovery failure preserves the exact previously accepted persistent generation', async () => {
  const root = fixture();
  try {
    const snapshot = await runApplication(getWorkspaceSnapshot(root, 'off'));
    const candidate = makeWorkspaceProjectionCandidate(snapshot, { files: [], directories: [], publicationChanged: false }, new Date().toISOString(), 'fixture-sources');
    const context = workspaceProjectionContext(root);
    storeWorkspaceProjection(context, candidate);
    const previous = readWorkspaceProjection(context);
    storeWorkspaceProjection(context, undefined, new ConcordError('RecoveryRequired', 'An interrupted publication exists'));
    const blocked = readWorkspaceProjection(context);
    assert.equal(blocked.projection.builtAt, previous.projection.builtAt);
    assert.equal(blocked.projection.status, 'blocked');
    assert.deepEqual(blocked.snapshot, previous.snapshot);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a drifted candidate retains the last consistent generation and reports the attempt without failing', async () => {
  const root = fixture();
  const snapshot = await runApplication(getWorkspaceSnapshot(root, 'off'));
  const context = workspaceProjectionContext(root);
  try {
    storeWorkspaceProjection(context, makeWorkspaceProjectionCandidate(snapshot, { files: [], directories: [], publicationChanged: false }, new Date(Date.now() - 1000).toISOString(), 'fixture-sources'));
    const healthy = readWorkspaceProjection(context);
    assert.equal(healthy.projection.status, 'ready');
    storeWorkspaceProjection(context, makeWorkspaceProjectionCandidate(snapshot, { files: ['src/main.ts'], directories: [], publicationChanged: false }, new Date().toISOString(), 'drifted-sources'));
    const retained = readWorkspaceProjection(context);
    assert.equal(retained.projection.status, 'ready', 'source drift during editing is not a refresh failure');
    assert.deepEqual(retained.projection.changedPaths, []);
    assert.equal(retained.projection.lastError, undefined);
    assert.deepEqual(retained.projection.lastAttempt?.changedPaths, ['src/main.ts']);
    assert.equal(retained.projection.lastAttempt?.complete, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('observeProjection reports observed file drift without throwing the candidate away', () => {
  const root = fixture();
  const repo = new LocalRepository(root, { optimistic: true, access: 'read' });
  try {
    const target = 'docs/feature/projected/README.md';
    const original = readFileSync(join(root, target), 'utf8');
    const result = repo.observeProjection(() => {
      assert.equal(repo.read(target), original);
      writeFileSync(join(root, target), `${original}\nDrifted after read.\n`);
      return { ok: true as const };
    });
    assert.equal(result.value.ok, true, 'file drift does not throw the candidate away');
    assert.deepEqual(result.drift.files, [target]);
    assert.deepEqual(result.drift.directories, []);
    assert.equal(result.drift.publicationChanged, false);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('a first drifting candidate stores only its attempt and remains pending without a sourceDigest', async () => {
  const root = fixture();
  try {
    const snapshot = await runApplication(getWorkspaceSnapshot(root, 'off'));
    const candidate = makeWorkspaceProjectionCandidate(snapshot, { files: ['src/main.ts'], directories: [], publicationChanged: false }, new Date().toISOString(), 'must-not-publish');
    assert.equal(candidate.sourceDigest, undefined);
    const context = workspaceProjectionContext(root);
    storeWorkspaceProjection(context, candidate);
    assert.throws(() => readWorkspaceProjection(context), { code: 'WorkspaceProjectionPending' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
