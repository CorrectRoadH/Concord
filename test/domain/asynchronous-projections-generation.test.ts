import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { queryContext, queryRequestSatisfied, readQuery, storeQuery } from '../../src/app/index.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { writeProjectConfig } from '../support/support.ts';

// @use-case docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
test('publication of an older scan cannot satisfy a later refresh request', async () => {
  const root = createConsumer();
  try {
    writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
    const repo = new LocalRepository(root);
    try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); }
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
  const root = createConsumer();
  try {
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    const missing = await runApplication(queryContext(root, ['trace', 'gaps']));
    writeProjectConfig(root, { testRoots: [], sourceRoots: [] });
    assert.notEqual((await runApplication(queryContext(root, missing.query))).key, missing.key);
    rmSync(join(root, 'concord.config.ts'));
    assert.equal((await runApplication(queryContext(root, missing.query))).key, missing.key);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
