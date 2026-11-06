// 跨进程保证：文件监听——真实watcher在无HTTP刷新请求时观察同长度文档编辑、原子保存及替换inode的后续编辑。
import { readWorkspaceProjection, createDocument, initialize, Workspace, NodeServices, installedConcordCli, parseWorkspaceProjectionOutput, genericPrivateDirectorySync, spawnSync, assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, tmpdir, dirname, join, test, Effect, Schema, ConcordError, digest, failure, LocalRepository, startViewServer, identifyProjection, readProjectConfig, writeProjectConfig, ownerPath, mainSource, busyDetails, write, fixture, closeServer, startServer, readPublished, waitForPublished, sourceDigest, waitForSource, workspaceProjectionContext, type WorkspaceProjection, type ViewServerHandle } from './view-watch-fixture.ts';


// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('View publishes external same-length edits and atomic saves without any requests', () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const root = yield* fixture();
  yield* Effect.sync(() => {
    writeProjectConfig(root, { ...readProjectConfig(root), sourceIgnore: ['src/vendor'] });
    mkdirSync(join(root, 'src/vendor'));
    symlinkSync(root, join(root, 'src/vendor/cycle'));
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
