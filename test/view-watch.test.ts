import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { createDocument } from '../dist/documents.js';
import { ConcordError, digest, failure } from '../dist/shared.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import type { WorkspaceProjection } from '../dist/view-contract.js';
import { startViewServer, type ViewServerHandle } from '../dist/view-server.js';
import { readWorkspaceProjection, workspaceProjectionContext } from '../dist/workspace-projection.js';
import { readProjectConfig, writeProjectConfig } from './support.js';

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
  yield* Effect.sync(() => {
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [], sourceRoots: ['src'] });
      createDocument(repo, 'feature', { id: 'projected', title: 'Projected feature', pages: ['architecture'] });
    } finally { repo.close(); }
    write(root, 'src/main.ts', mainSource);
  });
  return root;
});

const closeServer = (server: ViewServerHandle) => Effect.tryPromise({ try: () => server.close(), catch: failure }).pipe(Effect.timeout(10_000));
const startServer = (root: string) => Effect.acquireRelease(
  Effect.tryPromise({ try: () => startViewServer({ root, host: '127.0.0.1', port: 0 }), catch: failure }),
  server => closeServer(server).pipe(Effect.orDie),
);

/** Only the durable read API is polled: no HTTP request or refresh method is called. */
function readPublished(root: string): WorkspaceProjection | undefined {
  try { return readWorkspaceProjection(workspaceProjectionContext(root)); }
  catch (cause) {
    if (cause instanceof ConcordError && (cause.code === 'WorkspaceProjectionPending'
      || cause.code === 'WorkspaceProjectionUnavailable' && Schema.is(busyDetails)(cause.details))) return undefined;
    throw cause;
  }
}

const waitForPublished = Effect.fn('waitForWatchedProjection')(function* (
  root: string, description: string, accepts: (value: WorkspaceProjection) => boolean,
) {
  // Consecutive changes must finish before the 30-second compensation cadence.
  const deadline = performance.now() + 15_000;
  let last: WorkspaceProjection | undefined;
  for (;;) {
    last = yield* Effect.sync(() => readPublished(root));
    if (last?.projection.status === 'ready' && last.projection.consistent && accepts(last)) return last;
    if (performance.now() >= deadline) assert.fail(`${description} was not published within 15 seconds: ${JSON.stringify({ projection: last?.projection, findings: last?.snapshot.findings, sources: last?.snapshot.sources })}`);
    yield* Effect.sleep(100);
  }
});

const sourceDigest = (value: WorkspaceProjection, path: string): string | undefined => value.snapshot.sources.find(source => source.path === path)?.digest;
const waitForSource = (root: string, path: string, source: string) => waitForPublished(root, `source ${path}`, value => sourceDigest(value, path) === digest(source));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('View publishes external same-length edits and atomic saves without any requests', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* fixture();
  yield* Effect.sync(() => {
    symlinkSync(join(root, 'absent-secret'), join(root, 'src/.env'));
    mkdirSync(join(root, 'src/.env.local'));
    symlinkSync(root, join(root, 'src/.env.local/cycle'));
  });
  yield* startServer(root);
  const initial = yield* waitForSource(root, 'src/main.ts', mainSource);
  const editedOwner = yield* Effect.sync(() => {
    const before = readFileSync(join(root, ownerPath), 'utf8');
    const after = before.replaceAll('Projected feature', 'Observedx feature');
    assert.notEqual(after, before);
    assert.equal(Buffer.byteLength(after), Buffer.byteLength(before));
    writeFileSync(join(root, ownerPath), after);
    return after;
  });
  const edited = yield* waitForPublished(root, 'same-length document edit', value => value.snapshot.documents.some(document => document.path === ownerPath
    && document.digest === digest(editedOwner) && document.metadata.title === 'Observedx feature'));
  assert.notEqual(edited.projection.builtAt, initial.projection.builtAt);

  const savedSource = mainSource.replace('1', '2');
  yield* Effect.sync(() => {
    assert.equal(Buffer.byteLength(savedSource), Buffer.byteLength(mainSource));
    write(root, 'src/main.ts.next', savedSource);
    renameSync(join(root, 'src/main.ts.next'), join(root, 'src/main.ts'));
  });
  yield* waitForSource(root, 'src/main.ts', savedSource);
  // A second edit of the replaced inode must also be observed.
  const laterSource = mainSource.replace('1', '3');
  yield* Effect.sync(() => write(root, 'src/main.ts', laterSource));
  yield* waitForSource(root, 'src/main.ts', laterSource);
}))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('View follows new nested directories, deletion and recreation, and changed sourceRoots without requests', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* fixture();
  yield* startServer(root);
  yield* waitForSource(root, 'src/main.ts', mainSource);

  const nestedPath = 'src/new/deep/nested.ts';
  const nestedSource = 'export const nested = 1;\n';
  yield* Effect.sync(() => write(root, nestedPath, nestedSource));
  yield* waitForSource(root, nestedPath, nestedSource);
  const editedSource = nestedSource.replace('1', '2');
  yield* Effect.sync(() => write(root, nestedPath, editedSource));
  yield* waitForSource(root, nestedPath, editedSource);

  yield* Effect.sync(() => rmSync(join(root, 'src/new'), { recursive: true }));
  yield* waitForPublished(root, 'deleted nested directory', value => sourceDigest(value, nestedPath) === undefined);
  const recreatedSource = nestedSource.replace('1', '3');
  yield* Effect.sync(() => write(root, nestedPath, recreatedSource));
  yield* waitForSource(root, nestedPath, recreatedSource);
  const laterSource = nestedSource.replace('1', '4');
  yield* Effect.sync(() => write(root, nestedPath, laterSource));
  yield* waitForSource(root, nestedPath, laterSource);

  const newPath = 'app/deep/current.ts';
  const newSource = 'export const current = 1;\n';
  const changedConfig = yield* Effect.sync(() => {
    write(root, newPath, newSource);
    writeProjectConfig(root, { ...readProjectConfig(root), sourceRoots: ['app'] });
    return readFileSync(join(root, 'concord.config.ts'), 'utf8');
  });
  yield* waitForPublished(root, 'changed sourceRoots', value => value.snapshot.configDigest === digest(changedConfig)
    && value.snapshot.project?.sourceRoots?.length === 1 && value.snapshot.project.sourceRoots[0] === 'app'
    && sourceDigest(value, newPath) === digest(newSource) && sourceDigest(value, 'src/main.ts') === undefined);
  const watchedSource = newSource.replace('1', '2');
  yield* Effect.sync(() => write(root, newPath, watchedSource));
  yield* waitForSource(root, newPath, watchedSource);
  // A directory created after the config generation needs its own continuing watch.
  const newestPath = 'app/later/deep/next.ts';
  yield* Effect.sync(() => write(root, newestPath, newSource));
  yield* waitForSource(root, newestPath, newSource);
  yield* Effect.sync(() => write(root, newestPath, watchedSource));
  yield* waitForSource(root, newestPath, watchedSource);
}))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('cache publication settles and closing View stops updates and releases its resources', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* fixture();
  const server = yield* startServer(root);
  yield* waitForSource(root, 'src/main.ts', mainSource);
  let previousBuiltAt: string | undefined;
  let quietSince = performance.now();
  yield* waitForPublished(root, 'idle initial generation', value => {
    if (value.projection.refreshOwner !== 'none' || value.projection.builtAt !== previousBuiltAt) {
      previousBuiltAt = value.projection.builtAt;
      quietSince = performance.now();
    }
    return performance.now() - quietSince >= 1_500;
  });
  const generations = new Set<string>();
  const observeUntil = performance.now() + 4_000;
  while (performance.now() < observeUntil) {
    const value = yield* Effect.sync(() => readPublished(root));
    if (value !== undefined) {
      assert.equal(value.projection.status, 'ready');
      if (value.projection.builtAt !== previousBuiltAt) generations.add(value.projection.builtAt);
      // One scheduled compensation can cross this window; repeated cache-induced scans cannot.
      assert.ok(generations.size <= 1, 'cache publication must not continually schedule more generations');
    }
    yield* Effect.sleep(100);
  }

  // Close with a fresh invalidation queued or scanning, rather than only an idle service.
  yield* Effect.sync(() => write(root, 'src/main.ts', mainSource.replace('1', '8')));
  yield* Effect.sleep(300);
  yield* closeServer(server);
  const closed = yield* Effect.sync(() => readWorkspaceProjection(workspaceProjectionContext(root)));
  assert.equal(closed.projection.refreshOwner, 'none');
  assert.equal(server.server.listening, false);
  yield* Effect.sync(() => {
    assert.equal(existsSync(join(workspaceProjectionContext(root).privateDir, 'workspace-refresh/current')), false);
    const reopened = new LocalRepository(root);
    try { assert.ok(reopened.read('concord.config.ts')); } finally { reopened.close(); }
    write(root, 'src/main.ts', mainSource.replace('1', '9'));
    write(root, 'src/after-close/deep/new.ts', mainSource);
    const owner = readFileSync(join(root, ownerPath), 'utf8');
    write(root, ownerPath, owner.replaceAll('Projected feature', 'Observedx feature'));
  });
  const stoppedUntil = performance.now() + 3_000;
  while (performance.now() < stoppedUntil) {
    const value = yield* Effect.sync(() => readWorkspaceProjection(workspaceProjectionContext(root)));
    assert.deepEqual(value, closed, 'closed View must not publish or acquire another refresh lease after filesystem edits');
    yield* Effect.sleep(100);
  }
}))));
