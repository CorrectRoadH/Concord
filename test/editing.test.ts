import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createDocument } from '../dist/documents.js';
import { inspectDocuments, listSources, readSource, setConfig, setMarkdown, setMetadata, setSource } from '../dist/editing.js';
import { digest } from '../dist/shared.js';
import { LocalRepository, initialize } from '../dist/storage.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'concord-editing-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { sourceRoots: ['src'] }); } finally { initial.close(); }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), 'export const answer = 1;\n');
  return root;
}

function withRepository(run: (root: string, repo: LocalRepository) => void): void {
  const root = fixture();
  const repo = new LocalRepository(root);
  try { run(root, repo); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

function throwsCode(code: string, operation: () => unknown): void {
  assert.throws(operation, error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

// @concord-case workbench-edits-known-content-only
// @concord-contract docs/feature/web-workbench/use-case/use-web-workbench.md
test('editing exposes configured source and known Markdown only, preserving managed metadata', () => Effect.runPromise(Effect.sync(() => withRepository((root, repo) => {
  assert.deepEqual(listSources(repo).map(item => item.path), ['src/main.ts']);
  const source = readSource(repo, 'src/main.ts');
  assert.equal(setSource(repo, source.path, 'export const answer = 2;\n', source.digest).operation, 'set-source');
  assert.equal(readFileSync(join(root, 'src/main.ts'), 'utf8'), 'export const answer = 2;\n');
  throwsCode('SourceNotFound', () => readSource(repo, 'concord.json'));
  createDocument(repo, 'feature', { id: 'pages', title: 'Pages', pages: ['architecture'] });
  const support = inspectDocuments(repo).pages.find(item => item.path === 'docs/feature/pages/architecture.md');
  assert.equal(support?.documentPath, 'docs/feature/pages/README.md', 'support pages must be reachable through their owner');

  createDocument(repo, 'research', { id: 'study', title: 'Study', body: '# Notes\n', observedAt: '2026-09-14', sources: ['https://example.invalid'] });
  let document = inspectDocuments(repo).documents.find(item => item.metadata.id === 'study');
  assert.ok(document);
  setMetadata(repo, document.path, { title: 'Updated study', sources: ['https://example.invalid/v2'] }, document.digest);
  document = inspectDocuments(repo).documents.find(item => item.metadata.id === 'study');
  assert.equal(document?.metadata.title, 'Updated study');
  assert.deepEqual(document?.metadata.kind === 'research' ? document.metadata.sources : [], ['https://example.invalid/v2']);
  const edited = setMarkdown(repo, document!.path, '# Edited notes\n', document!.digest);
  assert.deepEqual(edited.changedPaths, [document!.path]);
  assert.equal(inspectDocuments(repo).documents.find(item => item.metadata.id === 'study')?.body, '# Edited notes\n');

  writeFileSync(join(root, 'docs', 'feature', 'plain.md'), '# Plain\n');
  const page = inspectDocuments(repo).pages.find(item => item.path === 'docs/feature/plain.md');
  assert.ok(page);
  setMarkdown(repo, page.path, '# Rewritten\n', page.digest);
  throwsCode('FileNotFound', () => setMarkdown(repo, 'README.md', '# no\n', 'sha256:none'));
  writeFileSync(join(root, 'memory', 'bad.md'), '---\nformat: concord.document/v1\nid: bad\n---\nbody\n');
  const malformed = inspectDocuments(repo).pages.find(item => item.path === 'memory/bad.md');
  assert.equal(malformed?.readOnly, true);
  assert.match(malformed?.body ?? '', /format: concord\.document/u);
  throwsCode('ReadOnlyDocument', () => setMarkdown(repo, malformed!.path, '# Repair\n', malformed!.digest));
}))));

// @concord-case workbench-edits-config-strictly
// @concord-contract docs/feature/web-workbench/use-case/use-web-workbench.md
test('config editing keeps project identity and validates source roots', () => Effect.runPromise(Effect.sync(() => withRepository((_root, repo) => {
  const source = repo.read('concord.json')!;
  throwsCode('ImmutableProjectIdentity', () => setConfig(repo, { ...repo.config, projectId: 'other-project' }, digest(source)));
  throwsCode('InvalidSourcePath', () => setConfig(repo, { ...repo.config, sourceRoots: ['node_modules'] }, digest(source)));
  throwsCode('InvalidSourcePath', () => setConfig(repo, { ...repo.config, testRoots: ['node_modules'] }, digest(source)));
  const receipt = setConfig(repo, { ...repo.config, sourceRoots: ['src', 'test'] }, digest(source));
  assert.deepEqual(receipt.changedPaths, ['concord.json']);
}))));

// @concord-case workbench-edits-test-root-source
// @concord-contract docs/feature/web-workbench/use-case/use-web-workbench.md
test('editing includes existing JS/TS files from testRoots without treating runner source files as roots', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-editing-test-root-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    const initial = new LocalRepository(root, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    mkdirSync(join(root, 'test'), { recursive: true });
    mkdirSync(join(root, 'runner-only'), { recursive: true });
    writeFileSync(join(root, 'test', 'association.ts'), 'export const association = 1;\n');
    writeFileSync(join(root, 'runner-only', 'setup.ts'), 'export const setup = 1;\n');
    const config = JSON.parse(readFileSync(join(root, 'concord.json'), 'utf8'));
    config.runner.sourceFiles = ['runner-only/setup.ts'];
    writeFileSync(join(root, 'concord.json'), `${JSON.stringify(config, null, 2)}\n`);
    repo = new LocalRepository(root);
    assert.deepEqual(listSources(repo).map(item => item.path), ['test/association.ts']);
    const source = readSource(repo, 'test/association.ts');
    setSource(repo, source.path, 'export const association = 2;\n', source.digest);
    assert.equal(readFileSync(join(root, 'test', 'association.ts'), 'utf8'), 'export const association = 2;\n');
    throwsCode('SourceNotFound', () => readSource(repo!, 'runner-only/setup.ts'));
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @concord-case workbench-recovers-source-publication
// @concord-contract docs/feature/local-sdlc/use-case/recover-local-state.md
test('source recovery freezes the exact configuration and preserves external edits', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  let repo: LocalRepository | undefined;
  try {
    const before = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    const after = 'export const answer = 3;\n';
    const config = readFileSync(join(root, 'concord.json'), 'utf8');
    const journal = {
      format: 'concord.journal', root, privateDir: join(root, '.git', 'concord'), projectId: JSON.parse(config).projectId,
      operation: 'set-source', phase: 'prepared', directories: [],
      changes: [{ path: 'src/main.ts', before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }],
      scope: { kind: 'source', configSource: config, configDigest: digest(config) },
    };
    writeFileSync(join(root, 'src', 'main.ts'), after);
    writeFileSync(join(root, '.git', 'concord', 'journal.json'), `${JSON.stringify(journal)}\n`);
    repo = new LocalRepository(root, { recover: true });
    writeFileSync(join(root, 'concord.json'), `${config}\n`);
    throwsCode('RecoveryConflict', () => repo!.recover());
    writeFileSync(join(root, 'concord.json'), config);
    writeFileSync(join(root, 'src', 'main.ts'), 'external\n');
    throwsCode('RecoveryConflict', () => repo!.recover());
    assert.equal(existsSync(join(root, '.git', 'concord', 'journal.json')), true);
    writeFileSync(join(root, 'src', 'main.ts'), after);
    assert.equal(repo.recover().status, 'rolled-back');
    assert.equal(readFileSync(join(root, 'src', 'main.ts'), 'utf8'), before);
    const committed = { ...journal, phase: 'committed' };
    writeFileSync(join(root, 'src', 'main.ts'), after);
    writeFileSync(join(root, '.git', 'concord', 'journal.json'), `${JSON.stringify(committed)}\n`);
    assert.equal(repo.recover().status, 'committed');
    assert.equal(readFileSync(join(root, 'src', 'main.ts'), 'utf8'), after);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
