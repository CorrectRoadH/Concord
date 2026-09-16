import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { addPage, createDocument, loadDocuments, resolveReference, showPage } from '../dist/documents.js';
import { inspectDocuments, setMarkdown } from '../dist/editing.js';
import { initialize, LocalRepository } from '../dist/storage.js';

// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('research starts without a questionnaire and supports nested freeform pages with strict owner boundaries', t => {
  const root = mkdtempSync(join(tmpdir(), 'concord-research-package-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true });
  t.after(() => { repo.close(); rmSync(root, { recursive: true, force: true }); });
  initialize(repo);
  createDocument(repo, 'research', { id: 'topic', title: '自由研究' });
  const owner = loadDocuments(repo)[0]!;
  assert.equal(owner.path, 'docs/research/topic/README.md');
  assert.equal(owner.body.trim(), '# 自由研究');
  assert.equal(owner.metadata.kind === 'research' && owner.metadata.observedAt, undefined);
  addPage(repo, 'research', 'topic', '资料/比较');
  assert.equal(showPage(repo, 'research', 'topic', '资料/比较').body.trim(), '# 比较');
  assert.equal(resolveReference(repo, loadDocuments(repo), 'docs/research/topic/资料/比较.md', ['research']).metadata.id, 'topic');
  assert.throws(() => addPage(repo, 'research', 'topic', '../escape'), { code: 'UnsafePath' });
  mkdirSync(join(root, 'docs/research/topic/broken'), { recursive: true });
  writeFileSync(join(root, 'docs/research/topic/broken/README.md'), '---\nformat: concord.document/v1\nkind: research\n---\n');
  writeFileSync(join(root, 'docs/research/topic/broken/notes.md'), '# Notes\n');
  const blocked = inspectDocuments(repo).pages.find(page => page.path.endsWith('/broken/notes.md'))!;
  assert.equal(blocked.readOnly, true);
  assert.equal(blocked.documentPath, undefined);
  assert.throws(() => setMarkdown(repo, blocked.path, '# Changed\n', blocked.digest), { code: 'ReadOnlyDocument' });
});
