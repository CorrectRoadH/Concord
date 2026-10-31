import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { queryContext } from '../../src/app/index.js';
import { setAuthor } from '../../src/domain/documents/index.js';
import { digest } from '../../src/model/index.js';
import { LocalRepository, runApplication } from '../support/repository.js';
import { createDocument, readQuery, storeQuery } from '../support/operations.js';
import { createConsumer } from '../support/consumer.js';
import { writeProjectConfig } from '../support/support.js';
const gaps = (marker = 'original') => ({ operation: 'trace-gaps' as const, semantics: 'missing-explicit-relationships-not-coverage' as const, limitations: [marker], contracts: [], cliPages: [], unmarkedLists: [], cache: { status: 'off', hits: 0, misses: 0, path: 'cache' } });
const candidate = (marker = 'original', scannedAt = Date.now()) => ({ kind: 'candidate' as const, message: { format: 'concord.query-scan/v1' as const, ok: true as const, scannedAt, finishedAt: Date.now(), value: gaps(marker), complete: true, unknown: [], drift: { files: [], directories: [], publicationChanged: false } } });
function consumer() { const root = createConsumer(); writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] }); const repo = new LocalRepository(root); try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); } finally { repo.close(); } return root; }

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('failed refresh retains a full oldest snapshot at namespace capacity and success clears its error', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = consumer();
  try {
    const context = await runApplication(queryContext(root, ['trace', 'gaps']));
    storeQuery(context, candidate());
    for (let i = 0; i < 63; i++) storeQuery({ ...context, key: `other-${i}` }, candidate(String(i)));
    storeQuery(context, { kind: 'failure', error: { failedAt: new Date().toISOString(), scannedAt: Date.now(), code: 'QueryRefreshFailed', message: 'failed scan' } });
    const failed = readQuery(context);
    assert.deepEqual(failed.record?.value, gaps());
    assert.equal(failed.error?.code, 'QueryRefreshFailed');
    storeQuery(context, candidate('refreshed'));
    const succeeded = readQuery(context);
    assert.deepEqual(succeeded.record?.value, gaps('refreshed'));
    assert.equal(succeeded.error, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

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
})));

// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('a complete A-B-A publication is detected before the writer releases ownership', () => Effect.runPromise(Effect.sync(() => {
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
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
    assert.ok(existsSync(join(root, '.git/concord/trace/publication.lease')));
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true, force: true }); }
})));
