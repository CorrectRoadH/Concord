// 跨进程保证：文件监听——真实watcher无请求跟踪嵌套目录创建删除重建和配置root变更，并持续观察新目录。
import { readWorkspaceProjection, createDocument, initialize, Workspace, NodeServices, installedConcordCli, parseWorkspaceProjectionOutput, genericPrivateDirectorySync, spawnSync, assert, execFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync, tmpdir, dirname, join, test, Effect, Schema, ConcordError, digest, failure, LocalRepository, startViewServer, identifyProjection, readProjectConfig, writeProjectConfig, ownerPath, mainSource, busyDetails, write, fixture, closeServer, startServer, readPublished, waitForPublished, sourceDigest, waitForSource, workspaceProjectionContext, type WorkspaceProjection, type ViewServerHandle } from './view-watch-fixture.ts';


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

  yield* Effect.sync(() => writeProjectConfig(root, { ...readProjectConfig(root), sourceIgnore: ['src/new'] }));
  yield* waitForPublished(root, 'sourceIgnore removes existing sources', value => value.snapshot.project?.sourceIgnore?.includes('src/new') === true
    && sourceDigest(value, nestedPath) === undefined);
  yield* Effect.sync(() => writeProjectConfig(root, { ...readProjectConfig(root), sourceIgnore: [] }));
  yield* waitForSource(root, nestedPath, laterSource);
  yield* Effect.sync(() => write(root, nestedPath, editedSource));
  yield* waitForSource(root, nestedPath, editedSource);

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
