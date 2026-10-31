import { createDocument } from '../support/operations.js';
import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { checkDesign, decideDesign } from '../../src/domain/designs/index.js';
import { loadDocuments } from '../../src/domain/documents/index.js';
import { LocalRepository } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import { authorDesignFixture } from '../support/design-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
for (const form of ['directory', 'file']) test(`repository Design ${form} shares content gates, guards dry-run inputs, and retains the complete plan projection`, () => {
  const root = createConsumer();
  const run = <A>(operation: (repo: LocalRepository) => A): A => { const repo = new LocalRepository(root); try { return operation(repo); } finally { repo.close(); } };
  try {
    run(repo => createDocument(repo, 'design', { id: 'storage', title: 'Storage', alternatives: ['plan-1', 'plan-2'] }));
    assert.match(readFileSync(join(root, 'docs/design/storage/plans/plan-1/README.md'), 'utf8'), /## Limits/u);
    assert.throws(() => run(repo => decideDesign(repo, 'storage', 'plan-2', [], 'Choose the local store.', true)), { code: 'DesignDecisionIncomplete' });
    authorDesignFixture(root, 'storage', ['plan-1', 'plan-2'], 'plan-2');
    renameSync(join(root, 'docs/design/storage'), join(root, 'docs/design/中文决策'));
    const ref = 'docs/design/中文决策/README.md', base = join(root, 'docs/design/中文决策');
    const decisionPath = join(base, 'DECISION.md');
    writeFileSync(decisionPath, readFileSync(decisionPath, 'utf8').replace('query the local store', 'query the `local` store'));
    assert.equal(run(repo => checkDesign(repo, ref)).ok, true);
    if (form === 'file') {
      writeFileSync(join(base, 'plans/plan-2.md'), readFileSync(join(base, 'plans/plan-2/README.md'), 'utf8').replaceAll('../../', '../'));
      rmSync(join(base, 'plans/plan-2'), { recursive: true });
      for (const page of ['README.md', 'DECISION.md']) writeFileSync(join(base, page), readFileSync(join(base, page), 'utf8').replaceAll('plans/plan-2/README.md', 'plans/plan-2.md'));
      assert.equal(run(repo => checkDesign(repo, ref)).ok, true);
    }
    writeFileSync(decisionPath, readFileSync(decisionPath, 'utf8').replace(/^Selected:.*\n/mu, ''));
    const owner = readFileSync(join(root, ref), 'utf8'), decision = readFileSync(decisionPath, 'utf8');
    const preview = run(repo => decideDesign(repo, ref, 'plan-2', [], 'Choose the local store.', true));
    const captured = ['README.md', 'GOALS.md', 'LIMITS.md', 'DECISION.md', 'plans/plan-1/README.md', form === 'file' ? 'plans/plan-2.md' : 'plans/plan-2/README.md', 'CASES.md'].map(path => `docs/design/中文决策/${path}`);
    assert.deepEqual(preview.changedPaths, captured);
    assert.equal(readFileSync(decisionPath, 'utf8'), decision);
    const selected = run(repo => decideDesign(repo, ref, 'plan-2', [], 'Choose the local store.'));
    assert.deepEqual(selected.changedPaths, captured);
    const record = run(repo => loadDocuments(repo).find(record => record.path === ref));
    assert.equal(record?.path, ref);
    assert.equal(record?.metadata.id, '中文决策');
    assert.deepEqual(record?.metadata.kind === 'design' ? record.metadata.alternatives : [], ['plan-1', 'plan-2']);
    assert.equal(readFileSync(join(root, ref), 'utf8'), owner);
    assert.match(readFileSync(decisionPath, 'utf8'), /Selected: \[plan-2\]\(plans\/plan-2(?:\/README)?\.md\)/u);
    assert.match(readFileSync(decisionPath, 'utf8'), /query the `local` store/u);
    assert.equal(run(repo => checkDesign(repo, ref)).ok, true);
    // Main publication validates captured bytes before the final rename.
    const repo = new LocalRepository(root);
    try {
      repo.beginSnapshot();
      const path = 'docs/design/中文决策/GOALS.md', before = repo.read(path)!;
      writeFileSync(join(root, path), `${before}\nConcurrent edit.\n`);
      assert.throws(() => repo.publish('check-design-preimage', [{ path, before, after: before }]), { code: 'FileChangedSinceRead' });
    } finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
