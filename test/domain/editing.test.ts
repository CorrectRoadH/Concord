import { createConsumer } from '../support/consumer.ts';
import type * as SharedTypes from '../../src/model/shared.ts';
import { createDocument } from '../support/operations.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';

import { inspectDocumentFile, inspectDocuments, listSources, readSource, setConfig, setMarkdown, setSource } from "../../src/app/index.ts";
import { digest } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { projectConfigPath, readProjectConfig, writeProjectConfig } from '../support/support.ts';

async function fixture(): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { sourceRoots: ['src'] });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.ts'), 'export const answer = 1;\n');
  return root;
}

async function withRepository(run: (root: string, repo: LocalRepository) => void): Promise<void> {
  const root = (await fixture());
  const repo = (await LocalRepository.open(root));
  try { await run(root, repo); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}

async function throwsCode(code: string, operation: () => unknown): Promise<void> {
  await assert.rejects(async () => await operation(), error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('editing exposes configured source and known Markdown only, with whole-file digest saves', () => Effect.runPromise(Effect.tryPromise(async () => (await withRepository(async (root, repo) => {
  assert.deepEqual(listSources(repo).map(item => item.path), ['src/main.ts']);
  const source = readSource(repo, 'src/main.ts');
  assert.equal((await setSource(repo, source.path, 'export const answer = 2;\n', source.digest)).operation, 'set-source');
  assert.equal(readFileSync(join(root, 'src/main.ts'), 'utf8'), 'export const answer = 2;\n');
  (await throwsCode('SourceNotFound', () => readSource(repo, 'concord.config.ts')));
  (await createDocument(repo, 'feature', { id: 'pages', title: 'Pages', pages: ['architecture'] }));
  const support = inspectDocuments(repo).pages.find(item => item.path === 'docs/feature/pages/architecture.md');
  assert.equal(support?.documentPath, 'docs/feature/pages/README.md', 'support pages must be reachable through their owner');

  (await createDocument(repo, 'engineering', { id: 'study', title: 'Study', body: '# Notes\n' }));
  let document = inspectDocuments(repo).documents.find(item => item.metadata.id === 'study');
  assert.ok(document);
  const edited = (await setMarkdown(repo, document!.path, '# Edited notes\n', document!.digest));
  assert.deepEqual(edited.changedPaths, [document!.path]);
  assert.equal(inspectDocuments(repo).documents.find(item => item.metadata.id === 'study')?.body, '# Edited notes\n');

  writeFileSync(join(root, 'docs', 'feature', 'plain.md'), '# Plain\n');
  const page = inspectDocuments(repo).pages.find(item => item.path === 'docs/feature/plain.md');
  assert.ok(page);
  (await setMarkdown(repo, page.path, '# Rewritten\n', page.digest));
  (await throwsCode('FileNotFound', async () => (await setMarkdown(repo, 'README.md', '# no\n', 'sha256:none'))));
})))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('project documents under docs are readable without becoming category owners', () => Effect.runPromise(Effect.tryPromise(async () => (await withRepository(async (root, repo) => {
  const inventory = inspectDocuments(repo);
  const architecture = inventory.pages.find(page => page.path === 'docs/architecture.md');
  const taste = inventory.pages.find(page => page.path === 'docs/taste.md');
  const template = inventory.pages.find(page => page.path === 'docs/_template/feature-design/library.md');
  assert.equal(architecture?.documentPath, undefined);
  assert.ok(template);
  assert.equal(inventory.documents.some(document => document.path === 'docs/architecture.md' || document.path === 'docs/taste.md'), false);

  let walks = 0;
  const files = repo.files.bind(repo);
  repo.files = path => { walks += 1; return files(path); };
  assert.deepEqual(inspectDocumentFile(repo, 'docs/architecture.md'), architecture);
  assert.deepEqual(inspectDocumentFile(repo, 'docs/taste.md'), taste);
  assert.equal(walks, 0, 'opening one project document must not enumerate the repository');

  const saved = (await setMarkdown(repo, architecture!.path, '# Project architecture\n\nSaved from the workbench.\n', architecture!.digest));
  assert.deepEqual(saved.changedPaths, ['docs/architecture.md']);
  assert.match(readFileSync(join(root, 'docs/architecture.md'), 'utf8'), /Saved from the workbench/);
  (await setMarkdown(repo, taste!.path, `${taste!.body}\nAdditional principle.\n`, taste!.digest));
  assert.doesNotMatch(readFileSync(join(root, 'docs/taste.md'), 'utf8'), /status: draft/);

  mkdirSync(join(root, 'docs/notes'), { recursive: true });
  writeFileSync(join(root, 'docs/notes/extra.md'), '# Extra\n');
  const extra = inspectDocuments(repo).pages.find(page => page.path === 'docs/notes/extra.md');
  (await setMarkdown(repo, extra!.path, '---\ntitle: Changed\n---\n# Changed\n', extra!.digest));
  assert.equal(readFileSync(join(root, 'docs/notes/extra.md'), 'utf8'), '---\ntitle: Changed\n---\n# Changed\n');
  const updated = inspectDocumentFile(repo, extra!.path)!;
  (await throwsCode('FileChangedSinceRead', async () => (await setMarkdown(repo, updated.path, '# Stale\n', extra!.digest))));
  (await setMarkdown(repo, updated.path, '', updated.digest));
  assert.equal(readFileSync(join(root, updated.path), 'utf8'), '');
})))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('config editing rejects retired fields and validates source roots', () => Effect.runPromise(Effect.tryPromise(async () => (await withRepository(async (_root, repo) => {
  const source = repo.configSnapshot.source;
  (await throwsCode('InvalidData', async () => (await setConfig(repo, { ...repo.config, projectId: 'other-project' } as unknown as SharedTypes.ProjectConfig, digest(source)))));
  (await throwsCode('InvalidSourcePath', async () => (await setConfig(repo, { ...repo.config, sourceRoots: ['node_modules'] }, digest(source)))));
  (await throwsCode('InvalidSourcePath', async () => (await setConfig(repo, { ...repo.config, testRoots: ['node_modules'] }, digest(source)))));
  const receipt = (await setConfig(repo, { ...repo.config, sourceRoots: ['src', 'test'] }, digest(source)));
  assert.deepEqual(receipt.changedPaths, [repo.configSnapshot.path]);
})))));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('editing includes existing JS/TS files from testRoots without treating unrelated directories as roots', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await createConsumer());
  let repo: LocalRepository | undefined;
  try {
    writeProjectConfig(root, { testRoots: ['test'] });
    mkdirSync(join(root, 'test'), { recursive: true });
    mkdirSync(join(root, 'unrelated'), { recursive: true });
    writeFileSync(join(root, 'test', 'association.ts'), 'export const association = 1;\n');
    writeFileSync(join(root, 'unrelated', 'setup.ts'), 'export const setup = 1;\n');
    const config = (await readProjectConfig(root));
    writeProjectConfig(root, config);
    repo = (await LocalRepository.open(root));
    assert.deepEqual(listSources(repo).map(item => item.path), ['test/association.ts']);
    const source = readSource(repo, 'test/association.ts');
    (await setSource(repo, source.path, 'export const association = 2;\n', source.digest));
    assert.equal(readFileSync(join(root, 'test', 'association.ts'), 'utf8'), 'export const association = 2;\n');
    (await throwsCode('SourceNotFound', () => readSource(repo!, 'unrelated/setup.ts')));
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md
test('source recovery freezes the exact configuration and preserves external edits', () => Effect.runPromise(Effect.tryPromise(async () => {
  const root = (await fixture());
  let repo: LocalRepository | undefined;
  try {
    const before = readFileSync(join(root, 'src', 'main.ts'), 'utf8');
    const after = 'export const answer = 3;\n';
    const configPath = projectConfigPath(root);
    const config = readFileSync(join(root, configPath), 'utf8');
    const journal = {
      format: 'concord.journal', root, privateDir: join(root, '.git', 'concord'),
      operation: 'set-source', phase: 'prepared', directories: [],
      changes: [{ path: 'src/main.ts', before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }],
      scope: { kind: 'source', configPath, configSource: config, configDigest: digest(config) },
    };
    writeFileSync(join(root, 'src', 'main.ts'), after);
    writeFileSync(join(root, '.git', 'concord', 'journal.json'), `${JSON.stringify(journal)}\n`);
    repo = (await LocalRepository.open(root, { recover: true }));
    writeFileSync(join(root, configPath), `${config}\n`);
    (await throwsCode('RecoveryConflict', async () => (await repo!.recover())));
    writeFileSync(join(root, configPath), config);
    writeFileSync(join(root, 'src', 'main.ts'), 'external\n');
    const discarded = await repo!.recover();
    assert.equal(discarded.status, 'discarded');
    assert.deepEqual(discarded.warnings, ['src/main.ts']);
    assert.equal(existsSync(join(root, '.git', 'concord', 'journal.json')), false);
    assert.equal(readFileSync(join(root, 'src', 'main.ts'), 'utf8'), 'external\n');
    writeFileSync(join(root, '.git', 'concord', 'journal.json'), `${JSON.stringify(journal)}\n`);
    writeFileSync(join(root, 'src', 'main.ts'), after);
    assert.equal((await repo.recover()).status, 'rolled-back');
    assert.equal(readFileSync(join(root, 'src', 'main.ts'), 'utf8'), before);
    const committed = { ...journal, phase: 'committed' };
    writeFileSync(join(root, 'src', 'main.ts'), after);
    writeFileSync(join(root, '.git', 'concord', 'journal.json'), `${JSON.stringify(committed)}\n`);
    assert.equal((await repo.recover()).status, 'committed');
    assert.equal(readFileSync(join(root, 'src', 'main.ts'), 'utf8'), after);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('Markdown save publishes the complete owner and catalog bytes using only the whole-file digest', () => Effect.runPromise(Effect.tryPromise(async () => (await withRepository(async (root, repo) => {
  (await createDocument(repo, 'issue', { id: 'observation', title: 'Observation' }));
  const issue = inspectDocumentFile(repo, 'docs/issues/observation.md')!;
  const before = readFileSync(join(root, issue.path), 'utf8');
  assert.equal(issue.body, before, 'the editor must receive frontmatter and Markdown as one file');
  const after = `${before}\nResolved locally.\n`;
  (await setMarkdown(repo, issue.path, after, issue.digest));
  assert.equal(readFileSync(join(root, issue.path), 'utf8'), after);
  (await throwsCode('FileChangedSinceRead', async () => (await setMarkdown(repo, issue.path, before, issue.digest))));
  const catalog = inspectDocumentFile(repo, 'docs/concepts.md')!;
  const invalid = '# Editing in progress\n\nThis will be validated by check.\n';
  (await setMarkdown(repo, catalog.path, invalid, catalog.digest));
  assert.equal(readFileSync(join(root, catalog.path), 'utf8'), invalid);
})))));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('default source discovery does not authorize Web source writes', () => Effect.runPromise(Effect.tryPromise(async () => {
  // The absent configuration is the input under test; an initialized template would authorize writes.
  const root = mkdtempSync(join(tmpdir(), 'concord-default-source-write-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]); mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/main.ts'), 'export const value = 1;\n');
    repo = (await LocalRepository.open(root));
    assert.deepEqual(repo.config.sourceRoots, ['src']);
    const source = readSource(repo, 'src/main.ts');
    (await throwsCode('InvalidSourcePath', async () => (await setSource(repo!, source.path, 'export const value = 2;\n', source.digest))));
    assert.equal(readFileSync(join(root, source.path), 'utf8'), source.body);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
