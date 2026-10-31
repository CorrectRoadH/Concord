import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, runApplication } from '../support/repository.js';
import { createConsumer } from '../support/consumer.js';
import { createDocument } from '../support/operations.js';
import { writeProjectConfig } from '../support/support.js';
import { setAuthor } from '../../src/domain/documents/index.js';
import { digest } from '../../src/model/index.js';
function consumer() {
  const root = createConsumer(); writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try { createDocument(repo, 'feature', { id: 'sample', title: 'Sample' }); } finally { repo.close(); }
  return root;
}



// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('directory observations detect a size change even when an oversized file was not read', () => runApplication(Effect.sync(() => {
  const root = consumer();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
  const reader = new LocalRepository(root, { access: 'read' });
  try {
    reader.beginSnapshot(); reader.files('src');
    writeFileSync(join(root, 'src', 'large.ts'), '// @feature docs/feature/sample/README.md\n');
    assert.throws(() => reader.verifySnapshot(), { code: 'FileChangedSinceRead' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));



// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('concurrent optimistic plans reject the losing writer without overwriting the winner', () => runApplication(Effect.sync(() => {
  const root = consumer();
  const first = new LocalRepository(root, { optimistic: true });
  const second = new LocalRepository(root, { optimistic: true });
  const path = 'docs/feature/sample/README.md';
  try {
    first.beginSnapshot(); second.beginSnapshot();
    const before = first.read(path)!; second.read(path);
    setAuthor(first, path, '# First\n', digest(before));
    assert.throws(() => setAuthor(second, path, '# Second\n', digest(before)), { code: 'FileChangedSinceRead' });
    assert.match(readFileSync(join(root, path), 'utf8'), /First/);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
})));
