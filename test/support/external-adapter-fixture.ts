import { createConsumer, retainConsumer } from './consumer.ts';
import { stopWorkspaceServer } from './stop-workspace-server.ts';
import { createDocument } from './operations.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';



export const externalCase = Effect.fn('adapterTest.externalCase')(function*() {
  const root = yield* scratch; const { cli, tool } = yield* setup(root, true);
  const consumer = yield* Effect.acquireRelease(Effect.tryPromise(createConsumer), path => Effect.sync(() => {
    try { stopWorkspaceServer(path, cli); }
    catch (cause) { retainConsumer(path); throw cause; }
    rmSync(path, { recursive: true, force: true });
  }));
  yield* Effect.tryPromise(async () => {
    const repo = (await LocalRepository.open(consumer));
    try {
      (await createDocument(repo, 'feature', { id: 'example', title: 'Example' }));
      (await createDocument(repo, 'issue', { id: 'problem', title: 'Problem' }));
    } finally { repo.close(); }
    text(consumer, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(tool, 'node_modules'), join(consumer, 'node_modules'), 'dir');
    text(consumer, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
  });
  yield* Effect.tryPromise(async () => {
    copyFileSync(join(sourceRoot, 'test/fixtures/process-adapter.ts'), join(consumer, 'adapter.ts'));
    text(consumer, 'fixture.txt', 'original'); text(consumer, 'fixture.lock', 'locked'); text(consumer, 'mode.txt', 'green');
    text(consumer, 'test/sample.ts', '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @issue docs/issues/problem.md\n');
    (await configure(consumer, [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }]));
  });
  const id = yield* idFor(consumer, cli);
  return { consumer, cli, id };
});
