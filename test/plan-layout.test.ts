import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, initialize } from '../dist/storage.js';
import { createDocument, checkDesign, decideDesign, loadDocuments } from '../dist/documents.js';
import { addPage, showPage, setPage } from '../dist/document-pages.js';
import { resolveReference } from '../dist/refs.js';
import { readDesignPlanPaths } from '../dist/document-layout.js';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { authorDesignFixture } from './design-fixture.js';

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('file and directory Plans share gates, nested editing, reference ownership and workspace paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-plan-layout-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  try {
    await Effect.runPromise(Effect.sync(() => {
      initialize(repo, false, { testRoots: [] });
      createDocument(repo, 'design', { id: 'storage', title: 'Storage', alternatives: ['local', 'remote'] });
      authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
      const base = 'docs/design/storage';
      const entry = `${base}/plans/local.md`;
      const original = readFileSync(join(root, base, 'plans/local/README.md'), 'utf8');
      writeFileSync(join(root, entry), original.replaceAll('../../', '../'));
      assert.throws(() => checkDesign(repo, 'storage'), { code: 'AmbiguousDesignPlan' });
      rmSync(join(root, base, 'plans/local'), { recursive: true });
      writeFileSync(join(root, base, 'DECISION.md'), readFileSync(join(root, base, 'DECISION.md'), 'utf8').replace('plans/local/README.md', 'plans/local.md'));
      assert.equal(checkDesign(repo, 'storage').ok, true);
      assert.equal(showPage(repo, 'design', 'storage', 'README', 'local').path, entry);
      assert.throws(() => addPage(repo, 'design', 'storage', 'storage/snapshot', false, 'local'), { code: 'DesignPlanRequiresDirectory' });
      addPage(repo, 'design', 'storage', '存储/快照.md', false, 'remote');
      const page = showPage(repo, 'design', 'storage', '存储/快照.md', 'remote');
      setPage(repo, 'design', 'storage', '存储/快照.md', '# 快照\n\n## 边界\n\n本地读取。\n', page.digest, false, 'remote');
      assert.throws(() => setPage(repo, 'design', 'storage', '存储/快照.md', '# stale', page.digest, false, 'remote'), { code: 'PreimageChanged' });
      assert.equal(resolveReference(repo, loadDocuments(repo), `${page.path}#边界`).path, `${base}/README.md`);
      assert.throws(() => addPage(repo, 'design', 'storage', 'plans/remote/bypass'), { code: 'InvalidPage' });
      assert.throws(() => addPage(repo, 'design', 'storage', '../escape', false, 'remote'));
      const receipt = decideDesign(repo, 'storage', 'local', [], 'Local storage');
      assert(receipt.changedPaths.includes(page.path));
      mkdirSync(join(root, base, 'plans/local'));
      assert.throws(() => readDesignPlanPaths(root, base, ['local', 'remote']), { code: 'AmbiguousDesignPlan' });
      rmSync(join(root, base, 'plans/local'), { recursive: true });
    }));
    const workspace = await Effect.runPromise(getWorkspaceSnapshot(root));
    assert(JSON.stringify(workspace).includes('docs/design/storage/plans/local.md'));
    assert(JSON.stringify(workspace).includes('docs/design/storage/plans/remote/存储/快照.md'));
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
});
