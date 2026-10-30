import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createDocument, inspectDocuments } from '../../src/app/index.js';
import { addPage, setPage, showPage, loadDocuments, resolveReference } from '../../src/domain/documents/index.js';
import { tracePrivateDirectorySync } from '../../src/base/publication/index.js';
import { renderDocument, digest } from '../../src/model/index.js';
import { LocalRepository } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';

function repository(t: import('node:test').TestContext) {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = <A>(operation: (repo: LocalRepository) => A): A => { const repo = new LocalRepository(root); try { return operation(repo); } finally { repo.close(); } };
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  return { root, run, write };
}

test('Research package is title-only by default and supports free-form pages', t => {
  const { root, run } = repository(t);
  const created = run(repo => createDocument(repo, 'research', { id: '主题', title: '自由研究' }));
  assert.equal(created.operation, 'create-research');
  const readme = readFileSync(join(root, 'docs/research/主题/README.md'), 'utf8');
  assert.equal(readme, '# 自由研究\n'); assert.doesNotMatch(readme, /boundary|nextEvidence|observedOn/u);
  run(repo => addPage(repo, 'research', '主题', '材料/中文页'));
  run(repo => setPage(repo, 'research', '主题', '材料/中文页', '# 材料\n\n任意正文\n', digest(repo.read('docs/research/主题/材料/中文页.md')!)));
  assert.equal(run(repo => showPage(repo, 'research', '主题', '材料/中文页')).body, '# 材料\n\n任意正文\n');
  assert.deepEqual(run(repo => inspectDocuments(repo)).findings, []);
});

test('Research protects existing and nested owners', t => {
  const { run, write } = repository(t);
  write('docs/research/topic/existing.md', 'existing\n');
  assert.throws(() => run(repo => createDocument(repo, 'research', { id: 'topic', title: '抢占' })), { code: 'DocumentExists' });
  run(repo => createDocument(repo, 'research', { id: 'parent', title: '父' }));
  write('docs/research/parent/nested/README.md', '# 子\n');
  assert.throws(() => run(repo => addPage(repo, 'research', 'parent', 'nested/page')), { code: 'InvalidPageOwner' });
  write('docs/research/parent/nested/README.md', '---\nformat: concord.document/v1\nnot: valid\n---\n');
  assert.throws(() => run(repo => addPage(repo, 'research', 'parent', 'nested/other')), { code: 'InvalidData' });
});

test('Research assigns files to the deepest owner and rejects unsafe or malformed ancestors', t => {
  const { run, write } = repository(t);
  write('docs/research/outer/README.md', '---\nformat: concord.document/v1\nnot: valid\n---\n');
  assert.throws(() => run(repo => createDocument(repo, 'research', { id: 'child', title: '子' })), { code: 'InvalidData' });
  assert.throws(() => run(repo => createDocument(repo, 'research', { id: 'bad#topic', title: '坏' })), { code: 'InvalidData' });
  write('docs/research/outer/README.md', '# Outer\n');
  run(repo => createDocument(repo, 'research', { id: 'tree', title: '树' }));
  write('docs/research/tree/nested/README.md', '# 子\n');
  write('docs/research/tree/nested/child.md', '# 子材料\n');
  assert.equal(run(repo => resolveReference(repo, loadDocuments(repo), 'docs/research/tree/nested/child.md', ['research'])).path, 'docs/research/tree/nested/README.md');
  write('docs/research/tree/legacy.md', '---\nformat: concord.document/v1\nid: legacy\nkind: research\n---\n\n# 旧\n');
  assert.ok(run(repo => inspectDocuments(repo)).findings.some(finding => finding.code === 'InvalidData'));
});

test('Research reports invalid placement for standalone owners and rejects symlinks and recovery journals', t => {
  const { root, run, write } = repository(t);
  write('docs/research/old/page.md', renderDocument({ format: 'concord.document/v1', id: 'old', title: '旧', kind: 'research', sources: [] }, '# 旧\n'));
  assert.throws(() => run(repo => resolveReference(repo, loadDocuments(repo), 'docs/research/old/page.md', ['research'])), { code: 'ReferenceNotFound' });
  symlinkSync(join(root, 'docs/research/old'), join(root, 'docs/research/linked'));
  assert.throws(() => run(repo => repo.read('docs/research/linked/page.md')), { code: 'UnsafePath' });
  const privateDir = tracePrivateDirectorySync(root);
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(join(privateDir, 'multi-file-publication-journal.json'), '{}');
  assert.throws(() => new LocalRepository(root), { code: 'RecoveryRequired' });
  assert.equal(readFileSync(join(privateDir, 'multi-file-publication-journal.json'), 'utf8'), '{}');
});
