import { createDocument, addPage, templateBody } from '../support/operations.js';
import { authorDesignFixture } from '../support/design-fixture.js';
import { createConsumer } from '../support/consumer.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from '../support/temporary.js';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { renderOwnerFixture } from '../support/owner-fixture.js';

import { setPage, loadDocuments } from "../../src/domain/documents/index.js";
import { LocalRepository } from "../support/repository.js";
import { leafOwnerSelection, assertSameLeafSelection } from "../../src/domain/documents/index.js";
import { traceDigest } from "../../src/base/publication/index.js";


function write(root: string, path: string, source: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
function fixture(): string {
  const root = createConsumer();
  for (const path of ['docs/issues', 'memory', 'e2e']) mkdirSync(join(root, path), { recursive: true });
  write(root, 'memory/insight.md', renderOwnerFixture({ id: 'insight', title: 'Knowledge', kind: 'memory', type: 'insight', status: 'current', relations: [] }));
  write(root, 'docs/issues/issue.md', renderOwnerFixture({ id: 'issue', title: 'Issue', kind: 'issue', status: 'open', relations: [] }));
  write(root, 'docs/feature/migrated/README.md', renderOwnerFixture({ id: 'migrated', title: 'Feature', kind: 'feature' }));
  write(root, 'docs/feature/migrated/use-case/README.md', '# Use Cases\n');
  write(root, 'docs/feature/migrated/use-case/flow.md', renderOwnerFixture({ id: 'flow', title: 'Flow', kind: 'use-case', feature: 'docs/feature/migrated/README.md' }));
  write(root, 'docs/design/storage/README.md', renderOwnerFixture({ id: 'storage', title: 'Storage', kind: 'design', alternatives: ['files', 'sqlite'] }));
  for (const plan of ['files', 'sqlite']) write(root, `docs/design/storage/plans/${plan}/README.md`, `# ${plan}\n`);
  write(root, 'docs/design/storage/DECISION.md', '# Decision\n\n## Decision\n\nSelected: [files](plans/files/README.md)\n\n## Rationale\n\nFiles preserve the source.\n');
  authorDesignFixture(root, 'storage', ['files', 'sqlite'], 'files');
  execFileSync('git', ['-C', root, 'add', "."]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture']);
  return root;
}
const run = <A, E>(effect: Effect.Effect<A, E, import('effect').FileSystem.FileSystem>): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
test('advanced writing emits plain Spec pages and reads Design selection from DECISION', async () => {
  const root = fixture();
  try {
    const path = 'docs/design/storage/README.md';
    const repo = new LocalRepository(root);
    try {
    const decoded = loadDocuments(repo).find(record => record.path === path)!;
    assert.equal(decoded.metadata.kind === 'design' ? decoded.metadata.decision?.selected : undefined, 'files');
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
