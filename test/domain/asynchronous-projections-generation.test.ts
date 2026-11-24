import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { Deferred, Effect, Fiber, Result } from 'effect';
import { QueryRefreshRequest, persist, queryContext, queryRequestSatisfied, readQuery, refreshQuery, storeQuery, type QueryContext } from '../../src/app/index.ts';
import { HawdbFailure, PersistentCache } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { nativeArtifactRoot } from '../../src/base/installation/index.ts';
import { acquireFileLease, releaseFileLease } from '../../src/base/publication/index.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('publication of an older scan cannot satisfy a later refresh request', async () => {
  const root = (await createConsumer());
  try {
    writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
    const repo = (await LocalRepository.open(root));
    try { (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample' })); }
    finally { repo.close(); }
    const context = await runApplication(queryContext(root, ['trace', 'gaps']));
    const requestedAt = Date.now() - 100;
    const scannedAt = requestedAt - 1000;
    const value = { operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: ['obsolete'], contracts: [], cliPages: [], unmarkedLists: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } };
    await runApplication(storeQuery(context, { kind: 'candidate', message: {
      format: 'concord.query-scan/v1', ok: true, scannedAt, finishedAt: Date.now(), value,
      complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false },
    } }));
    const stored = await runApplication(readQuery(context));
    assert.ok(stored.record, JSON.stringify(stored));
    assert.equal(stored.record.scannedAt, scannedAt);
    assert.deepEqual(stored.record.value, value);
    assert.equal(queryRequestSatisfied(stored, scannedAt), true);
    assert.equal(queryRequestSatisfied(stored, requestedAt), false, 'publication time cannot satisfy a later request');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('diagnostic query identity binds configuration appearing after an absent configuration', async () => {
  const root = (await createConsumer());
  try {
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    const missing = await runApplication(queryContext(root, ['trace', 'gaps']));
    writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
    assert.notEqual((await runApplication(queryContext(root, missing.query))).key, missing.key);
    rmSync(join(root, 'concord.config.ts'));
    assert.equal((await runApplication(queryContext(root, missing.query))).key, missing.key);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
// @spec docs/feature/local-data-engine/architecture.md#刷新
test('a queued diagnostic refresh requests the new identity after the configuration changes', async () => {
  const root = await createConsumer();
  try {
    await runApplication(Effect.scoped(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const previous = yield* queryContext(root, ['trace', 'gaps']);
      const lease = acquireFileLease(root, join(previous.privateDir, 'query-refresh'), previous.key, 'exclusive', 'query-refresh');
      assert.ok(lease);
      try {
        const queued = yield* Deferred.make<void>();
        const requested: QueryContext[] = [];
        const pending = yield* Effect.forkChild(refreshQuery(root, previous.query, Date.now()).pipe(
          Effect.provideService(Workspace, {
            ...workspace,
            identify: (...args) => workspace.identify(...args).pipe(Effect.tap(() => Deferred.succeed(queued, undefined))),
          }),
          Effect.provideService(QueryRefreshRequest, {
            request: context => Effect.sync(() => { requested.push(context); }),
          }),
        ));
        yield* Deferred.await(queued);
        writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
        const expected = yield* queryContext(root, previous.query);
        assert.notEqual(expected.key, previous.key);
        releaseFileLease(lease, 'query-refresh');
        yield* Fiber.join(pending);
        assert.deepEqual(requested, [expected]);
      } finally { releaseFileLease(lease, 'query-refresh'); }
    })));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
// @spec docs/feature/local-data-engine/use-case/query-asynchronous-projections.md#结果
test('a diagnostic refresh cannot retry publication after its cache retry deadline', async () => {
  const root = await createConsumer();
  try {
    await runApplication(Effect.gen(function*() {
      const workspace = yield* Workspace;
      const cache = yield* PersistentCache;
      const context = yield* queryContext(root, ['trace', 'gaps']);
      const busy = new HawdbFailure('HawdbBusy', 'Cache occupied by another operation');
      let blocked = false;
      const result = yield* persist(context, { kind: 'failure', error: {
        code: 'TraceInvalid', message: 'Invalid trace', scannedAt: Date.now(), failedAt: new Date().toISOString(),
      } }).pipe(
        Effect.provideService(Workspace, {
          ...workspace,
          identify: (...args) => blocked
            ? Effect.sleep('3 seconds').pipe(Effect.andThen(workspace.identify(...args)))
            : workspace.identify(...args),
        }),
        Effect.provideService(PersistentCache, {
          ...cache,
          update: (...args) => {
            if (blocked) return cache.update(...args);
            blocked = true;
            return Effect.fail(busy);
          },
        }),
        Effect.result,
      );
      const stored = yield* readQuery(context);
      assert.equal(stored.error, undefined);
      assert.ok(Result.isFailure(result));
      assert.equal(result.failure, busy);
    }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @feature docs/engineering/testing/architecture.md#进程内-cli
// @issue docs/issues/test-architecture-gaps.md
test('diagnostic query identity follows each caller environment without falling back to the host', async () => {
  const root = (await createConsumer());
  const source = nativeArtifactRoot(makeRuntimeEnvironment(process.cwd(), process.env));
  try {
    const callers = ['a', 'b'].map(name => {
      const cwd = join(root, name);
      const runtime = makeRuntimeEnvironment(cwd, { ...process.env, XDG_CACHE_HOME: 'cache' });
      const destination = join(cwd, 'cache/concord/native', basename(source));
      mkdirSync(destination, { recursive: true });
      cpSync(source, destination, { recursive: true });
      writeFileSync(join(destination, 'caller-identity.txt'), name);
      return runtime;
    });
    const operation = queryContext(root, ['trace', 'gaps']);
    const contexts = [];
    for (const index of [0, 1, 0]) {
      contexts.push(await runApplication(operation.pipe(Effect.provideService(RuntimeEnvironment, callers[index]!))));
    }
    assert.notEqual(contexts[0]!.key, contexts[1]!.key);
    assert.equal(contexts[0]!.key, contexts[2]!.key);
    const missing = makeRuntimeEnvironment(join(root, 'missing'), { ...process.env, XDG_CACHE_HOME: 'cache' });
    const rejected = await runApplication(operation.pipe(Effect.provideService(RuntimeEnvironment, missing), Effect.result));
    assert.ok(Result.isFailure(rejected));
    assert.equal(rejected.failure.code, 'HawdbUnavailable');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
