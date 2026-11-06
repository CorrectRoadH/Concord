import { createDocument, addPage, templateBody } from '../support/operations.ts';
import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from '../support/temporary.ts';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { renderOwnerFixture } from '../support/owner-fixture.ts';

import { setPage, loadDocuments } from "../../src/domain/documents/index.ts";
import { LocalRepository } from "../support/repository.ts";
import { leafOwnerSelection, assertSameLeafSelection } from "../../src/domain/documents/index.ts";
import { traceDigest } from "../../src/base/publication/index.ts";


function write(root: string, path: string, source: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
function fixture(): string {
  const root = createConsumer();
  for (const path of ['docs/issues', 'memory', 'e2e']) mkdirSync(join(root, path), { recursive: true });
  write(root, 'memory/insight.md', renderOwnerFixture({ id: 'insight', title: 'Knowledge', kind: 'memory', relations: [] }));
  write(root, 'docs/issues/issue.md', renderOwnerFixture({ id: 'issue', title: 'Issue', kind: 'issue', relations: [] }));
  write(root, 'docs/feature/migrated/README.md', renderOwnerFixture({ id: 'migrated', title: 'Feature', kind: 'feature' }));
  write(root, 'docs/feature/migrated/use-case/README.md', '# Use Cases\n');
  write(root, 'docs/feature/migrated/use-case/flow.md', renderOwnerFixture({ id: 'flow', title: 'Flow', kind: 'use-case', feature: 'docs/feature/migrated/README.md' }));
  write(root, 'docs/design/storage.md', '# Storage\n\nCompare files and sqlite.\n');
  return root;
}
const run = <A, E>(effect: Effect.Effect<A, E, import('effect').FileSystem.FileSystem>): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
test('advanced writing emits plain Spec pages and reads a single Design page', async () => {
  const root = fixture();
  try {
    const path = 'docs/design/storage.md';
    const repo = new LocalRepository(root);
    try {
    const decoded = loadDocuments(repo).find(record => record.path === path)!;
    const base = 'docs/_template/feature-design';
    write(root, `${base}/README.md`, templateBody('feature', '<功能或候选名>'));
    write(root, `${base}/use-case/README.md`, templateBody('use-case-index', '<功能或候选名>'));
    write(root, `${base}/library.md`, templateBody('library', '<功能或候选名>'));
    createDocument(repo, 'feature', { id: 'written', title: 'Written', pages: ['use-case'] });
    createDocument(repo, 'use-case', { id: 'written-flow', feature: 'written', title: 'Written Flow', body: '# Written Flow\n' });
    addPage(repo, 'feature', 'written', 'library');
    const page = 'docs/feature/written/library.md';
    setPage(repo, 'feature', 'written', 'library', '# Updated\n', traceDigest(readFileSync(join(root, page), 'utf8')));
    assert.equal(readFileSync(join(root, 'docs/feature/written/README.md'), 'utf8').startsWith('---'), false);
    assert.equal(readFileSync(join(root, page), 'utf8'), '# Updated\n');
    assert.equal(readFileSync(join(root, 'docs/feature/written/use-case/written-flow.md'), 'utf8').startsWith('---'), false);
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
