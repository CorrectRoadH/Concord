import assert from 'node:assert/strict';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { checkCurrentProject, checkSince, traceShow } from '../../src/app/index.js';
import { readDocumentSelector } from '../../src/domain/documents/index.js';
import { closeFixedIssue, scanAnnotations } from '../../src/domain/tests/index.js';
import { renderDocument } from '../../src/model/index.js';
import { createFixConsumer, gitCommit } from '../support/fix-consumer.js';
import { LocalRepository, runApplication } from '../support/repository.js';

async function close(root: string, defect: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { await runApplication(closeFixedIssue(repo, 'sku', 'Accumulate quantity', defect)); }
  finally { repo.close(); }
}

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('plain check and trace retain recorded claims when tests move or disappear after F', async t => {
  for (const change of ['move', 'delete'] as const) await t.test(change, async () => {
    const f = createFixConsumer();
    try {
      f.fix(); await close(f.root, f.defect); gitCommit(f.root, 'record proof');
      const path = join(f.root, 'docs/issues/sku.md');
      const before = readFileSync(path, 'utf8');
      const oldTest = join(f.root, 'test/cart.test.ts');
      if (change === 'move') renameSync(oldTest, join(f.root, 'test/renamed.test.ts'));
      else rmSync(oldTest);
      gitCommit(f.root, 'later test layout');
      const checked = await runApplication(checkCurrentProject(f.root, 'off'));
      assert.equal(checked.ok, true, JSON.stringify(checked.findings));
      assert.equal(checked.verifications[0]?.verified, 'recorded');
      const repo = new LocalRepository(f.root);
      try {
        const trace = traceShow(repo, 'cart', 'off');
        assert.equal(trace.tests.length, change === 'move' ? 1 : 0);
        assert.ok(trace.tests.every(item => !checked.verifications[0]!.verification.tests.includes(item.id)));
      } finally { repo.close(); }
      const replayed = await runApplication(checkSince(f.root, f.defect));
      assert.equal(replayed.ok, true, JSON.stringify(replayed.findings));
      assert.equal(replayed.verifications[0]?.verified, 'replayed');
      assert.equal(readFileSync(path, 'utf8'), before);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#结果
test('replay rejects a handwritten F whose recorded test has no Issue marker at F', async () => {
  const f = createFixConsumer();
  try {
    f.fix(); await close(f.root, f.defect); gitCommit(f.root, 'record proof');
    const testPath = join(f.root, 'test/cart.test.ts');
    writeFileSync(testPath, readFileSync(testPath, 'utf8').replace('// @issue docs/issues/sku.md\n', ''));
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = 1;\n');
    const unlinkedDefect = gitCommit(f.root, 'unlinked defect');
    writeFileSync(join(f.root, 'src/cart.ts'), 'export const quantity = 2;\n');
    const unlinked = gitCommit(f.root, 'unlinked fix');
    const repo = new LocalRepository(f.root);
    let source: string;
    try {
      const issue = readDocumentSelector(repo, 'sku', 'issue');
      const metadata = issue.metadata;
      if (metadata.kind !== 'issue' || metadata.closure?.kind !== 'fixed' || !metadata.closure.verification) assert.fail('Expected fixed Issue');
      const verification = metadata.closure.verification;
      assert.ok(scanAnnotations(repo, { cache: 'off' }).cases.some(item => item.id === verification.tests[0] && !item.issues.includes('docs/issues/sku.md')), 'the recorded test exists at F but has no Issue relation');
      source = renderDocument({ ...metadata, closure: { ...metadata.closure, verification: { ...metadata.closure.verification, defect: unlinkedDefect, fix: unlinked } } }, issue.body);
    } finally { repo.close(); }
    const path = join(f.root, 'docs/issues/sku.md');
    writeFileSync(path, source);
    const checked = await runApplication(checkSince(f.root, f.defect));
    assert.equal(checked.ok, false);
    assert.ok(checked.findings.some(item => item.path === 'docs/issues/sku.md' && item.code === 'FixUnverifiable'), JSON.stringify(checked.findings));
    assert.ok(checked.verifications.every(item => item.verified !== 'replayed'));
    assert.equal(readFileSync(path, 'utf8'), source);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
