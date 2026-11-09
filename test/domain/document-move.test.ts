import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { moveDocument, planDocumentMove } from '../../src/app/index.ts';
import { loadDocuments, relocateMarkdown } from '../../src/domain/documents/index.ts';
import { runApplication } from '../support/repository.ts';
import { moveFixture, source, target, write } from '../support/document-move.ts';

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#preview
test('move previews the complete write set without changing sources and lists unmanaged literals', async () => moveFixture(async (root, repo) => {
  const result = await runApplication(moveDocument(repo, source, target, true));
  assert.equal(result.dryRun, true);
  assert.equal(existsSync(join(root, source)), true);
  assert.equal(existsSync(join(root, target)), false);
  assert.deepEqual(result.moves, [{ from: source, to: target }]);
  assert.deepEqual(result.unmanagedReferences, [{ path: 'notes.txt', line: 2 }, { path: 'notes.txt', line: 3 }, { path: 'test/one.test.ts', line: 3 }]);
  assert.deepEqual(result.changedPaths, [...result.changedPaths].sort());
  assert.equal(result.changedPaths.length, 7);
}));

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('move changes real links, YAML relations and markers only, preserving anchors, formatting and code literals', async () => moveFixture(async (root, repo) => {
  const before = readFileSync(join(root, 'docs/issues/one.md'), 'utf8');
  await runApplication(moveDocument(repo, source, target));
  assert.equal(existsSync(join(root, source)), false);
  assert.match(readFileSync(join(root, target), 'utf8'), /\[owner\]\(\.\.\/\.\.\/a\/README.md\)\r\n/u);
  assert.match(readFileSync(join(root, target), 'utf8'), /\{#run\}/u);
  assert.equal(readFileSync(join(root, 'docs/issues/one.md'), 'utf8'), before.replace(source, target).replace('../feature/a/use-case/one.md', '../feature/b/use-case/two.md'));
  assert.match(readFileSync(join(root, 'memory/one.md'), 'utf8'), new RegExp(target));
  assert.equal(readFileSync(join(root, 'docs/feature/a/use-case/README.md'), 'utf8'), '# Use Cases\n\n[one](../../b/use-case/two.md#run "title")\n\n[ref]: <../../b/use-case/two.md#run> "title"\n');
  const code = readFileSync(join(root, 'src/one.ts'), 'utf8');
  assert.match(code, new RegExp(`${target}#run`));
  const markers = readFileSync(join(root, 'test/one.test.ts'), 'utf8');
  assert.equal(markers, `// @use-case ${target}#run\r\n// @name one\r\nconst prose = '${source}';\r\n\r\n// @feature docs/feature/a/README.md\r\n// @name package\r\n`);
  assert.equal(loadDocuments(repo).find(document => document.path === target)?.metadata.kind, 'use-case');
}));

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#rename-package
test('package moves cross Spec categories, copy binary attachments and modes, rewrite package markers, and prune old directories', async () => moveFixture(async (root, repo) => {
  const attachment = 'docs/feature/a/assets/picture.bin';
  const bytes = readFileSync(join(root, attachment));
  mkdirSync(join(root, 'docs/feature/a/assets/empty'), { recursive: true });
  chmodSync(join(root, attachment), 0o775);
  const result = await runApplication(moveDocument(repo, 'docs/feature/a', 'docs/engineering/renamed'));
  assert.equal(result.moves.length, 4);
  assert.equal(existsSync(join(root, 'docs/feature/a')), false);
  assert.deepEqual(readFileSync(join(root, 'docs/engineering/renamed/assets/picture.bin')), bytes);
  assert.equal(statSync(join(root, 'docs/engineering/renamed/assets/picture.bin')).mode & 0o777, 0o775);
  assert.match(readFileSync(join(root, 'test/one.test.ts'), 'utf8'), /@feature docs\/engineering\/renamed\/README.md/u);
  assert.match(readFileSync(join(root, 'docs/engineering/renamed/use-case/one.md'), 'utf8'), /\[owner\]\(\.\.\/README.md\)/u);
}));

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('move rejects an observed input edit before publication with no writes', async () => moveFixture(async (root, repo) => {
  await assert.rejects(() => repo.snapshot(async () => {
    const plan = await planDocumentMove(repo, { from: source, to: target });
    write(root, 'src/one.ts', '// External edit\n');
    await repo.publishDocumentMove(plan);
  }), { code: 'FileChangedSinceRead' });
  assert.equal(existsSync(join(root, source)), true);
  assert.equal(existsSync(join(root, target)), false);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
}));

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
test('Markdown relocation preserves everything outside parsed destinations including nested syntax and code', () => {
  const text = '# Page\n\n`[x](one.md)`\n\n- [**one**](one.md#run "keep")\n\n[ref]:\n  <one.md#run> "title"\n\n![alt](one.md)\n\n```md\n[x](one.md)\n```\n';
  assert.equal(relocateMarkdown(text, 'docs/a.md', 'docs/a.md', path => path === 'docs/one.md' ? 'docs/else/two.md' : path), text.replace('(one.md#run "keep")', '(else/two.md#run "keep")').replace('<one.md#run>', '<else/two.md#run>').replace('![alt](one.md)', '![alt](else/two.md)'));
});

// @use-case docs/feature/local-sdlc/use-case/move-spec-documents.md#preview
test('unmanaged references use resulting file paths and exclude invalid UTF-8 tracked bytes', async () => moveFixture(async (root, repo) => {
  const before = readFileSync(join(root, source), 'utf8');
  write(root, source, `${before}\nLiteral: ${source}\n`);
  write(root, 'notes.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from(source)]));
  const result = await runApplication(moveDocument(repo, source, target, true));
  assert.deepEqual(result.unmanagedReferences, [{ path: target, line: 8 }, { path: 'test/one.test.ts', line: 3 }]);
}));
