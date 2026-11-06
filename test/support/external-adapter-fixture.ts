import { createConsumer } from './consumer.ts';
import { createDocument } from './operations.ts';
import { packageBin, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceConcord, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';



export const externalCase = Effect.fn('adapterTest.externalCase')(function*() {
  const root = yield* scratch; const { cli, tool } = yield* setup(root, true);
  const consumer = yield* Effect.acquireRelease(Effect.sync(createConsumer), path => Effect.sync(() => rmSync(path, { recursive: true, force: true })));
  yield* Effect.sync(() => {
    const repo = new LocalRepository(consumer);
    try {
      createDocument(repo, 'feature', { id: 'example', title: 'Example' });
      createDocument(repo, 'issue', { id: 'problem', title: 'Problem' });
    } finally { repo.close(); }
    text(consumer, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(tool, 'node_modules'), join(consumer, 'node_modules'), 'dir');
    text(consumer, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
  });
  yield* Effect.sync(() => {
    copyFileSync(join(sourceRoot, 'test/fixtures/process-adapter.ts'), join(consumer, 'adapter.ts'));
    text(consumer, 'fixture.txt', 'original'); text(consumer, 'fixture.lock', 'locked'); text(consumer, 'mode.txt', 'green');
    text(consumer, 'test/sample.ts', '// @feature docs/feature/example/README.md\n// @name parameter-group\n// @issue docs/issues/problem.md\n');
    configure(consumer, [{ id: 'external', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], frameworkVersion: 'fixture/v1', lockFiles: ['fixture.lock'], envNames: ['NODE_OPTIONS', 'PATH'], collectTimeoutMs: 1000, budgets: { reportFileBytes: 128 } }]);
  });
  const id = yield* idFor(consumer, cli);
  return { consumer, cli, id };
});
