import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { traceGaps } from '../../src/app/index.ts';
import { loadDocuments } from '../../src/domain/documents/index.ts';
import { LocalRepository } from '../support/repository.ts';

// @feature docs/engineering/testing/README.md#可追溯
test('automated acceptance contracts missing tests have an open Issue linked to them or their Feature', { timeout: 30000 }, () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const repo = (await LocalRepository.open(root, { access: 'read', persistentCache: 'off' }));
  try { (await repo.snapshot(async () => {
    const documents = loadDocuments(repo);
    const linkedSpecs = new Set(documents
      .flatMap(document => document.metadata.kind === 'issue' ? document.metadata.relations ?? [] : [])
      .filter(relation => relation.role === 'spec')
      .map(relation => relation.target.split('#')[0]));
    const missing = (await traceGaps(repo, 'off')).contracts.filter(gap => {
      if (!gap.missing.includes('test')) return false;
      const document = documents.find(document => document.path === gap.path);
      const feature = document?.metadata.kind === 'use-case' ? document.metadata.feature : undefined;
      // Browser, external host, and SDLC workflow guide Use Cases are outside this repository's automated acceptance.
      const externalOrWorkflowCases = new Set([
        'docs/feature/local-sdlc/use-case/find-unlinked-tests.md',
        'docs/feature/herdr-mod/use-case/hand-off-errors-to-agent.md',
        'docs/feature/herdr-mod/use-case/install-from-herdr.md',
        'docs/feature/local-sdlc/use-case/evolve-existing-spec.md',
        'docs/feature/local-sdlc/use-case/refactor-preserving-behavior.md',
        'docs/feature/local-sdlc/use-case/run-check-in-ci.md',
        'docs/feature/project-onboarding/use-case/document-existing-code.md',
      ]);
      if (feature === 'docs/feature/web-workbench/README.md' || externalOrWorkflowCases.has(gap.path)) return false;
      return !linkedSpecs.has(gap.path) && (feature === undefined || !linkedSpecs.has(feature));
    }).map(gap => gap.path).sort();
    assert.deepEqual(missing, [], `Trace contract gaps without an open Issue linked by spec:\n${missing.join('\n')}`);
  })); } finally { repo.close(); }
})));
