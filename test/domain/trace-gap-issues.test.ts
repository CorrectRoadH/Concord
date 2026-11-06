import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { traceGaps } from '../../src/app/index.ts';
import { loadDocuments } from '../../src/domain/documents/index.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/engineering/testing/README.md#可追溯
test('every checkout trace contract missing tests has an open Issue linked to it or its Feature', () => Effect.runPromise(Effect.sync(() => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const repo = new LocalRepository(root, { access: 'read', persistentCache: 'off' });
  try { repo.snapshot(() => {
    const documents = loadDocuments(repo);
    const linkedSpecs = new Set(documents
      .flatMap(document => document.metadata.kind === 'issue' ? document.metadata.relations ?? [] : [])
      .filter(relation => relation.role === 'spec')
      .map(relation => relation.target.split('#')[0]));
    const missing = traceGaps(repo, 'off').contracts.filter(gap => {
      if (!gap.missing.includes('test')) return false;
      const document = documents.find(document => document.path === gap.path);
      const feature = document?.metadata.kind === 'use-case' ? document.metadata.feature : undefined;
      return !linkedSpecs.has(gap.path) && (feature === undefined || !linkedSpecs.has(feature));
    }).map(gap => gap.path).sort();
    assert.deepEqual(missing, [], `Trace contract gaps without an open Issue linked by spec:\n${missing.join('\n')}`);
  }); } finally { repo.close(); }
})));
