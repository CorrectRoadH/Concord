import { addPage, createDocument, initialize } from '../support/operations.ts';
import { renderOwnerFixture } from '../support/owner-fixture.ts';
import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { checkDocuments, findDocument, loadDocuments, parseDocumentRecord, resolveReference, setAuthor, setPage, showPage } from "../../src/domain/documents/index.ts";
import { adoptRoadmap } from "../../src/app/index.ts";

import { closeIssue, linkIssue } from "../../src/domain/issues/index.ts";
import { linkMemory } from "../../src/app/index.ts";
import { renderDocument } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { inspectDocuments } from "../../src/app/index.ts";

function useConsumer(run: (repo: LocalRepository, root: string) => void): void {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try { return run(repo, root); }
  finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

function throwsCode(code: string, operation: () => unknown): void {
  assert.throws(operation, error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

test('shared owner decoding refuses frontmatter on a Spec owner', () => {
  const invalid = '---\nformat: concord.document/v1\nid: example\nkind: feature\n---\n# Body\n';
  throwsCode('InvalidData', () => parseDocumentRecord('docs/feature/示例/README.md', invalid));
});

// @feature docs/feature/local-sdlc/README.md
test('owner titles accept the declared boundary and reject multiline or oversized text', () => {
  for (const kind of ['feature', 'use-case', 'engineering'] as const) {
    const base = { format: 'concord.document/v1' as const, id: 'title-boundary', title: 'x'.repeat(1024) };
    const metadata = kind === 'use-case' ? { ...base, kind, feature: 'docs/feature/example/README.md' } : { ...base, kind };
    const source = renderDocument(metadata, `# ${base.title}\n`);
    const path = kind === 'use-case' ? 'docs/feature/example/use-case/title-boundary.md' : `docs/${kind}/title-boundary/README.md`;
    assert.equal(parseDocumentRecord(path, source)?.metadata.title.length, 1024);
    for (const title of ['x'.repeat(1025), 'First\nSecond', 'First\rSecond', 'First\u2028Second', 'First\u2029Second']) {
      throwsCode('InvalidData', () => renderDocument({ ...metadata, title }, '# Body\n'));
    }
  }
});
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('same Use Case names are selected by canonical path when ambiguous', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'feature', { id: 'accounts', title: 'Accounts', body: '# Accounts\n' });
  createDocument(repo, 'feature', { id: 'sessions', title: 'Sessions', body: '# Sessions\n' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Account sign in', body: '# Sign in\n', feature: 'accounts' });
  createDocument(repo, 'use-case', { id: 'sign-in', title: 'Session sign in', body: '# Sign in\n', feature: 'sessions' });
  const documents = loadDocuments(repo);
  assert.equal(documents.filter(document => document.metadata.kind === 'use-case' && document.metadata.id === 'sign-in').length, 2);
  throwsCode('AmbiguousDocument', () => findDocument(documents, 'sign-in', 'use-case'));
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('uses the memoryKind template when body is omitted', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'memory', { id: 'stale', title: 'Stale cache' });
  assert.match(findDocument(loadDocuments(repo), 'stale', 'memory').body, /## /u);
}))));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption rebases supported links and rejects unsafe source packages without writing', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'move', title: 'Move', body: '# Move\n\n[Other](../other/README.md)\n' });
  write(root, 'docs/roadmap/move/guide.md', '[Inner](nested.md) [Outer](../other/README.md)\n\n[outer]: ../other/README.md\n\n`[code](../other/README.md)`\n\n~~~md\n[example](../other/README.md)\n~~~\n\n    [indented](../other/README.md)\n');
  adoptRoadmap(repo, 'move', 'moved');
  const feature = findDocument(loadDocuments(repo), 'moved', 'feature');
  assert.match(feature.body, /\[Other\]\(\.\.\/\.\.\/roadmap\/other\/README\.md\)/u);
  const copied = repo.read('docs/feature/moved/guide.md');
  assert.ok(copied);
  assert.match(copied, /\[Inner\]\(nested\.md\) \[Outer\]\(\.\.\/\.\.\/roadmap\/other\/README\.md\)/u);
  assert.match(copied, /^\[outer\]: \.\.\/\.\.\/roadmap\/other\/README\.md/mu);
  assert.match(copied, /`\[code\]\(\.\.\/other\/README\.md\)`/u);
  assert.match(copied, /~~~md\n\[example\]\(\.\.\/other\/README\.md\)/u);
  assert.match(copied, /    \[indented\]\(\.\.\/other\/README\.md\)/u);
  createDocument(repo, 'roadmap', { id: 'attachment', title: 'Attachment', body: '# A\n' });
  write(root, 'docs/roadmap/attachment/data.json', '{}');
  throwsCode('UnsupportedAttachment', () => adoptRoadmap(repo, 'attachment', 'attachment-feature'));
  assert.equal(repo.read('docs/feature/attachment-feature/README.md'), undefined);
  createDocument(repo, 'roadmap', { id: 'nested', title: 'Nested', body: '# N\n' });
  write(root, 'docs/roadmap/nested/child.md', '---\ntitle: child\n---\n');
  throwsCode('InvalidData', () => adoptRoadmap(repo, 'nested', 'nested-feature'));
  assert.equal(repo.read('docs/feature/nested-feature/README.md'), undefined);
  rmSync(join(root, 'docs/roadmap/nested/child.md'));
  createDocument(repo, 'roadmap', { id: 'linked', title: 'Linked', body: '# L\n' });
  symlinkSync('../../other', join(root, 'docs/roadmap/linked/link'));
  throwsCode('UnsafePath', () => adoptRoadmap(repo, 'linked', 'linked-feature'));
  assert.equal(repo.read('docs/feature/linked-feature/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption detects a source-set change before publishing', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'roadmap', { id: 'drift', title: 'Drift', body: '# Drift\n' });
  let calls = 0;
  const unstable = new Proxy(repo, { get(target, key, receiver) {
    if (key !== 'files') return Reflect.get(target, key, receiver);
    return (prefix: string) => {
      const paths = target.files(prefix);
      if (prefix === 'docs/roadmap/drift' && ++calls === 2) return [...paths, 'docs/roadmap/drift/new.md'];
      return paths;
    };
  }});
  throwsCode('FileChangedSinceRead', () => adoptRoadmap(unstable, 'drift', 'drift-feature'));
  assert.equal(repo.read('docs/feature/drift-feature/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption detects source bytes and destination conflicts before publishing', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'bytes', title: 'Bytes', body: '# Bytes\n' });
  write(root, 'docs/roadmap/bytes/guide.md', '# Guide\n');
  let sourceCollection = false; let guideReads = 0;
  const unstable = new Proxy(repo, { get(target, key, receiver) {
    if (key === 'files') return (prefix: string) => { if (prefix === 'docs/roadmap/bytes') sourceCollection = true; return target.files(prefix); };
    if (key === 'read') return (path: string) => {
      const current = target.read(path);
      if (sourceCollection && path === 'docs/roadmap/bytes/guide.md' && ++guideReads === 2) return `${current}\nchanged`;
      return current;
    };
    return Reflect.get(target, key, receiver);
  }});
  throwsCode('FileChangedSinceRead', () => adoptRoadmap(unstable, 'bytes', 'bytes-feature'));
  assert.equal(repo.read('docs/feature/bytes-feature/README.md'), undefined);
  createDocument(repo, 'roadmap', { id: 'conflict', title: 'Conflict', body: '# Conflict\n' });
  write(root, 'docs/roadmap/conflict/guide.md', '# Guide\n');
  write(root, 'docs/feature/conflicted/guide.md', '# Existing\n');
  throwsCode('DocumentExists', () => adoptRoadmap(repo, 'conflict', 'conflicted'));
  assert.equal(repo.read('docs/feature/conflicted/README.md'), undefined);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
test('adoption refuses an existing destination before changing the package or Memory declarations', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'roadmap', { id: 'recovery', title: 'Recovery', body: '# Recovery\n' });
  write(root, 'docs/roadmap/recovery/nested/guide.md', '# Guide\n');
  createDocument(repo, 'memory', { id: 'choice', title: 'Choice' });
  const before = repo.read('memory/choice.md');
  mkdirSync(join(root, 'docs/feature/recovered/nested'), { recursive: true });
  throwsCode('DocumentExists', () => adoptRoadmap(repo, 'recovery', 'recovered'));
  assert.equal(repo.read('docs/feature/recovered/README.md'), undefined);
  assert.equal(repo.read('docs/roadmap/recovery/README.md'), '# Recovery\n');
  assert.equal(repo.read('docs/roadmap/recovery/nested/guide.md'), '# Guide\n');
  assert.equal(repo.read('memory/choice.md'), before);
  assert.equal(existsSync(join(repo.privateDir, 'journal.json')), false);
}))));
// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adopts Roadmap by moving its package and preserving navigation from Memory', () => Effect.runPromise(Effect.sync(() => useConsumer(repo => {
  createDocument(repo, 'roadmap', { id: 'offline', title: 'Offline mode', body: '# Offline mode\n\n## Sync policy\n' });
  createDocument(repo, 'memory', { id: 'prefer-local', title: 'Prefer local state', body: '# Decision\n\n[Plan](../docs/roadmap/offline/README.md#sync-policy)\n' });
  adoptRoadmap(repo, 'offline', 'offline-mode');
  const documents = loadDocuments(repo);
  throwsCode('DocumentNotFound', () => findDocument(documents, 'offline', 'roadmap'));
  const feature = findDocument(documents, 'offline-mode', 'feature');
  const memory = findDocument(documents, 'prefer-local', 'memory');
  assert.equal(feature.path, 'docs/feature/offline-mode/README.md');
  assert.match(memory.body, /\]\(\.\.\/docs\/feature\/offline-mode\/README\.md#sync-policy\)/u);
  assert.deepEqual(checkDocuments(repo, documents), []);
  throwsCode('DocumentNotFound', () => adoptRoadmap(repo, 'offline', 'second-feature'));
}))));



// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('Use Case identity follows its filename and nested Markdown stays a supporting page', () => Effect.runPromise(Effect.sync(() => useConsumer((repo, root) => {
  createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
  createDocument(repo, 'use-case', { id: 'internal-id', title: '独立名称', feature: 'sample' });
  const original = findDocument(loadDocuments(repo), 'internal-id', 'use-case');
  const namedPath = 'docs/feature/sample/use-case/中文名称.md';
  renameSync(join(root, original.path), join(root, namedPath));
  assert.equal(resolveReference(repo, loadDocuments(repo), namedPath).metadata.id, '中文名称');
  write(root, original.path, renderDocument(original.metadata, original.body));
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), []);
  write(root, 'docs/feature/sample/use-case/nested/support.md', '# Supporting material\n');
  assert.equal(resolveReference(repo, loadDocuments(repo), 'docs/feature/sample/use-case/nested/support.md').path, 'docs/feature/sample/README.md');
  write(root, 'docs/feature/sample/use-case/带 空格.md', '# Invalid name\n');
  throwsCode('InvalidData', () => loadDocuments(repo));
}))));
