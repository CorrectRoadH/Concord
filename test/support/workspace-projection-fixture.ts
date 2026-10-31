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

export function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-projection-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    initialize(repo, false, { testRoots: [], sourceRoots: ['src'] });
    createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const projectedValue = 1;\n');
  return root;
}

export const jsonHeaders = { 'content-type': 'application/json' };
export const baseOf = (server: ViewServerHandle): string => `http://127.0.0.1:${server.port}`;

export function interruptPublication(root: string): void {
  const repo = new LocalRepository(root);
  try {
    const path = 'docs/architecture.md';
    const before = repo.read(path)!;
    const after = before + '\nInterrupted\n';
    writeFileSync(join(repo.privateDir, 'journal.json'), JSON.stringify({ format: 'concord.journal', root, privateDir: repo.privateDir,
      operation: 'outlines', phase: 'prepared', directories: [],
      scope: { kind: 'documents', configPath: repo.configSnapshot.path, configSource: repo.configSnapshot.source, configDigest: repo.configSnapshot.digest },
      changes: [{ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 420 }] }));
  } finally { repo.close(); }
}

export const workspaceProjectionContext = (...args: Parameters<typeof identifyProjection>) => Effect.runSync(identifyProjection(...args).pipe(Effect.provide(Workspace.layer), Effect.provide(NodeServices.layer)));
