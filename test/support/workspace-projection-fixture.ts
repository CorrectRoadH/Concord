import { readWorkspaceProjection, storeWorkspaceProjection } from '../support/operations.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { NodeServices } from '@effect/platform-node';
import { runApplication } from '../support/repository.ts';
import { installedConcordCli, parseWorkspaceProjectionOutput } from '../support/support.ts';
import { installationResources } from "../../src/base/installation/index.ts";
import { sourceCli } from './source-consumer.ts';
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

export async function fixture(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'concord-projection-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try {
    (await initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }));
    (await createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] }));
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/main.ts'), 'export const projectedValue = 1;\n');
  return root;
}

export const jsonHeaders = { 'content-type': 'application/json' };
export const baseOf = (server: ViewServerHandle): string => `http://127.0.0.1:${server.port}`;

export async function interruptPublication(root: string): Promise<void> {
  const repo = (await LocalRepository.open(root));
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

export const workspaceProjectionContext = async (...args: Parameters<typeof identifyProjection>) => Effect.runPromise(identifyProjection(...args).pipe(Effect.provide(Workspace.layer), Effect.provide(NodeServices.layer), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env))));
