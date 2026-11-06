import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { queryContext, readQuery, storeQuery } from '../../src/app/index.ts';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { setAuthor } from '../../src/domain/documents/index.ts';
import { digest } from '../../src/model/index.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { createDocument } from '../support/operations.ts';
import { createConsumer } from '../support/consumer.ts';
import { writeProjectConfig } from '../support/support.ts';

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);
const gaps = (marker = 'original') => ({ operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [marker], contracts: [], cliPages: [], unmarkedLists: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } });
const candidate = (marker = 'original', scannedAt = Date.now()) => ({ kind: 'candidate' as const, message: { format: 'concord.query-scan/v1' as const, ok: true as const, scannedAt, finishedAt: Date.now(), value: gaps(marker), complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } } });
function consumer() { const root = createConsumer(); writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] }); const repo = new LocalRepository(root); try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); } finally { repo.close(); } return root; }

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('failed refresh retains a full oldest snapshot at namespace capacity and success clears its error', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer();
  try {
    const context = await runApplication(queryContext(root, ['trace', 'gaps']));
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* PersistentCache.owner(context.privateDir);
      yield* owner.open;
      yield* Effect.gen(function*() {
        yield* storeQuery(context, candidate());
        for (let i = 0; i < 63; i++) yield* storeQuery({ ...context, key: `other-${i}` }, candidate(String(i)));
        yield* storeQuery(context, { kind: 'failure', error: { failedAt: new Date().toISOString(), scannedAt: Date.now(), code: 'QueryRefreshFailed', message: 'failed scan' } });
        const failed = yield* readQuery(context);
        assert.deepEqual(failed.record?.value, gaps());
        assert.equal(failed.error?.code, 'QueryRefreshFailed');
        yield* storeQuery(context, candidate('refreshed'));
        const succeeded = yield* readQuery(context);
        assert.deepEqual(succeeded.record?.value, gaps('refreshed'));
        assert.equal(succeeded.error, undefined);
      }).pipe(Effect.provideService(PersistentCache, owner.service));
    })).pipe(Effect.provide(PersistentCache.layer)).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime)));
  } finally { rmSync(root, { recursive: true, force: true }); }
}).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('source reads do not own a lease and detect a concurrent successful publication', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot();
    const path = 'docs/feature/sample/README.md';
    const before = reader.read(path)!;
    assert.equal(existsSync(join(root, '.git/concord/trace/publication.lease')), false);
    const writer = new LocalRepository(root, { optimistic: true });
    try { setAuthor(writer, path, '# Changed\n', digest(before)); }
    finally { writer.close(); }
    assert.match(readFileSync(join(root, path), 'utf8'), /Changed/);
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
}).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime))));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a complete A-B-A publication preserves the same source result', () => Effect.runPromise(Effect.sync(() => {
  const root = consumer();
  const writer = new LocalRepository(root);
  const reader = new LocalRepository(root, { access: 'read' });
  const path = 'docs/feature/sample/README.md';
  try {
    writer.beginSnapshot();
    reader.beginSnapshot();
    const before = reader.read(path)!;
    writer.publish('test-edit', [{ path, before, after: `${before}\nchanged\n` }]);
    writer.publish('test-edit', [{ path, before: `${before}\nchanged\n`, after: before }]);
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
    assert.doesNotThrow(() => reader.verifySnapshot());
    assert.ok(existsSync(join(root, '.git/concord/trace/publication.lease')));
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); }
}).pipe(Effect.provideService(RuntimeEnvironment, nativeRuntime))));
