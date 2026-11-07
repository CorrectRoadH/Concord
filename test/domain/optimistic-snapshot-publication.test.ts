import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository, runApplication } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { writeProjectConfig } from '../support/support.ts';
import { setAuthor } from '../../src/domain/documents/index.ts';
import { digest } from '../../src/model/index.ts';
async function consumer() {
  const root = (await createConsumer()); writeProjectConfig(root, { testRoots: [], sourceRoots: ['src'] });
  const repo = (await LocalRepository.open(root));
  try { (await createDocument(repo, 'feature', { id: 'sample', title: 'Sample' })); } finally { repo.close(); }
  return root;
}



// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('directory observations detect a size change even when an oversized file was not read', () => runApplication(Effect.tryPromise(async () => {
  const root = (await consumer());
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
  const reader = (await LocalRepository.open(root, { access: 'read' }));
  try {
    reader.beginSnapshot(); reader.files('src');
    writeFileSync(join(root, 'src', 'large.ts'), '// @feature docs/feature/sample/README.md\n');
    assert.throws(() => reader.verifySnapshot(), { code: 'SourceChanged' });
  } finally { reader.close(); rmSync(root, { recursive: true, force: true }); }
})));



// @use-case docs/feature/portable-coordination/use-case/coordinate-local-publications.md
test('concurrent optimistic plans reject the losing writer without overwriting the winner', () => runApplication(Effect.tryPromise(async () => {
  const root = (await consumer());
  const first = (await LocalRepository.open(root, { optimistic: true }));
  const second = (await LocalRepository.open(root, { optimistic: true }));
  const path = 'docs/feature/sample/README.md';
  try {
    first.beginSnapshot(); second.beginSnapshot();
    const before = first.read(path)!; second.read(path);
    (await setAuthor(first, path, '# First\n', digest(before)));
    (await assert.rejects(async () => (await setAuthor(second, path, '# Second\n', digest(before))), { code: 'FileChangedSinceRead' }));
    assert.match(readFileSync(join(root, path), 'utf8'), /First/);
    assert.equal(existsSync(join(root, '.git/concord/journal.json')), false);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
})));
