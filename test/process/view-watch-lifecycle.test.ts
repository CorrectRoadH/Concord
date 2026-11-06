import { readWorkspaceProjection, createDocument, initialize, Workspace, NodeServices, installedConcordCli, parseWorkspaceProjectionOutput, genericPrivateDirectorySync, spawnSync, assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, tmpdir, dirname, join, test, Effect, Schema, ConcordError, digest, failure, LocalRepository, startViewServer, identifyProjection, readProjectConfig, writeProjectConfig, ownerPath, mainSource, busyDetails, write, fixture, closeServer, startServer, readPublished, waitForPublished, sourceDigest, waitForSource, workspaceProjectionContext, type WorkspaceProjection, type ViewServerHandle } from './view-watch-fixture.ts';


// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('cache publication settles and closing View stops updates and releases its resources', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* fixture();
  const server = yield* startServer(root);
  yield* waitForSource(root, 'src/main.ts', mainSource);
  let previousBuiltAt: string | undefined;
  let quietSince = performance.now();
  yield* waitForPublished(root, 'idle initial generation', value => {
    // The running workspace service owns refresh for its lifetime; quiescence is
    // observed from accepted generations rather than release of the old lease.
    if (value.projection.builtAt !== previousBuiltAt) {
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
  const closed = yield* Effect.sync(() => readPublished(root)!);
  assert.equal(closed.projection.refreshOwner, 'none');
  assert.equal((server.process.exitCode === null && server.process.signalCode === null), false);
  yield* Effect.sync(() => {
    assert.equal(existsSync(join(genericPrivateDirectorySync(root), 'workspace-refresh/current')), false);
    const reopened = new LocalRepository(root);
    try { assert.ok(reopened.read('concord.config.ts')); } finally { reopened.close(); }
    write(root, 'src/main.ts', mainSource.replace('1', '9'));
    write(root, 'src/after-close/deep/new.ts', mainSource);
    const owner = readFileSync(join(root, ownerPath), 'utf8');
    write(root, ownerPath, owner.replaceAll('Projected feature', 'Observedx feature'));
  });
  const stoppedUntil = performance.now() + 3_000;
  while (performance.now() < stoppedUntil) {
    const value = yield* Effect.sync(() => readPublished(root)!);
    assert.deepEqual(value, closed, 'closed View must not publish or acquire another refresh lease after filesystem edits');
    yield* Effect.sleep(100);
  }
}))));
