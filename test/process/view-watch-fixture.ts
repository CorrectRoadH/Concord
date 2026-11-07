import { readWorkspaceProjection } from '../support/operations.ts';
import { createDocument, initialize } from '../support/operations.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { NodeServices } from '@effect/platform-node';
import { installedConcordCli, parseWorkspaceProjectionOutput } from '../support/support.ts';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

import { ConcordError, digest, failure } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";

import type { WorkspaceProjection } from "../../src/model/index.ts";
import { startViewServer, type ViewServerHandle } from '../e2e/server.ts';
import { workspaceProjectionContext as identifyProjection } from "../../src/app/index.ts";
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const ownerPath = 'docs/feature/projected/README.md';
const mainSource = 'export const projectedValue = 1;\n';
const busyDetails = Schema.Struct({ reason: Schema.Literal('HawdbBusy') });

function write(root: string, path: string, source: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}

const fixture = Effect.fn('viewWatchFixture')(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-view-watch-'))),
    value => Effect.sync(() => rmSync(value, { recursive: true, force: true })),
  );
  yield* Effect.tryPromise(async () => {
    execFileSync('git', ['init', '-q', root]);
    const repo = (await LocalRepository.open(root, { initialize: true }));
    try {
      (await initialize(repo, false, { testRoots: [], sourceRoots: ['src'] }));
      (await createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] }));
    } finally { repo.close(); }
    write(root, 'src/main.ts', mainSource);
  });
  return root;
});

const closeServer = (server: ViewServerHandle) => Effect.tryPromise({ try: () => server.close(), catch: failure }).pipe(Effect.timeout(10_000));
const startServer = (root: string) => Effect.acquireRelease(
  Effect.tryPromise({ try: async () => startViewServer({ root, host: '127.0.0.1', port: 0 }), catch: failure }),
  server => closeServer(server).pipe(Effect.orDie),
);

/** Only the durable read API is polled: no HTTP request or refresh method is called. */
function readPublished(root: string): WorkspaceProjection | undefined {
  const result = spawnSync(process.execPath, [installedConcordCli(), '--root', root, '--json', 'workspace', 'projection'], { encoding: 'utf8', timeout: 10_000 });
  if (result.status === 0) return parseWorkspaceProjectionOutput(result.stdout);
  const error = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.String, details: Schema.optional(Schema.Unknown) })))(result.stderr);
  if (error.error === 'WorkspaceProjectionPending' || error.error === 'WorkspaceProjectionUnavailable' && Schema.is(busyDetails)(error.details)) return undefined;
  throw new Error(`Read installed projection exited ${result.status}: ${result.stdout}\n${result.stderr}`);
}

const waitForPublished = Effect.fn('waitForWatchedProjection')(function* (
  root: string, description: string, accepts: (value: WorkspaceProjection) => boolean,
) {
  // Consecutive changes must finish before the 30-second compensation cadence.
  const deadline = performance.now() + 15_000;
  let last: WorkspaceProjection | undefined;
  for (;;) {
    last = yield* Effect.sync(() => readPublished(root));
    if (last?.projection.status === 'ready' && accepts(last)) return last;
    if (performance.now() >= deadline) assert.fail(`${description} was not published within 15 seconds: ${JSON.stringify({ projection: last?.projection, findings: last?.snapshot.findings, sources: last?.snapshot.sources })}`);
    yield* Effect.sleep(100);
  }
});

const sourceDigest = (value: WorkspaceProjection, path: string): string | undefined => value.snapshot.sources.find(source => source.path === path)?.digest;
const waitForSource = (root: string, path: string, source: string) => waitForPublished(root, `source ${path}`, value => sourceDigest(value, path) === digest(source));

const workspaceProjectionContext = async (...args: Parameters<typeof identifyProjection>) => Effect.runPromise(identifyProjection(...args).pipe(Effect.provide(Workspace.layer), Effect.provide(NodeServices.layer), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env))));

export { readWorkspaceProjection, createDocument, initialize, Workspace, NodeServices, installedConcordCli, parseWorkspaceProjectionOutput, genericPrivateDirectorySync, spawnSync, assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, tmpdir, dirname, join, test, Effect, Schema, ConcordError, digest, failure, LocalRepository, startViewServer, identifyProjection, readProjectConfig, writeProjectConfig, ownerPath, mainSource, busyDetails, write, fixture, closeServer, startServer, readPublished, waitForPublished, sourceDigest, waitForSource, workspaceProjectionContext };
export type { WorkspaceProjection, ViewServerHandle };
