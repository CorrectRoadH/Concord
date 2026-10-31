import { writeConceptFile, writeWritingFile } from '../support/writing-files.js';
import { initialize, createDocument, addPage } from '../support/operations.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.js";

import { EMPTY_CONCEPT_CATALOG } from "../../src/model/index.js";
import { indexConcepts, readConceptCatalog, showConcepts } from "../../src/domain/concepts/index.js";
import { checkWriting } from "../../src/domain/writing/index.js";
import { showWriting } from "../../src/domain/writing/index.js";
import { checkProject } from "../../src/app/index.js";
import { setAuthor } from "../../src/domain/documents/index.js";

import { setPage } from "../../src/domain/documents/index.js";
import { setMarkdown } from "../../src/app/index.js";
import { digest } from "../../src/model/index.js";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-markdown-concepts-'));
  execFileSync('git', ['init', '-q', root]);
  const repo = new LocalRepository(root, { initialize: true, persistentCache: 'off' });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  return root;
};
const withRepo = <T>(root: string, run: (repo: LocalRepository) => T): T => {
  const repo = new LocalRepository(root, { persistentCache: 'off' });
  try { return run(repo); } finally { repo.close(); }
};
const write = (root: string, path: string, source: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };
const term = (id: string, spelling: string) => `# Terms\n\n## ${spelling} {#${id}}\n\nDefinition of ${spelling}.\n`;

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
// C4, C7, C8, C16, C17, C18
test('Markdown catalog structure is strict, preserves definition Markdown, and reports the failing line', () => Effect.runPromise(Effect.sync(() => {
  const source = '# Terms\n\nIntro.\n\n## Memory {#memory}\n\nA **durable** [finding](notes.md) with `code`.\n\n### Explanation\n\nExtra paragraphs.\n\n## Issue {#issue}\n\nAn observation.\n';
  const parsed = readConceptCatalog(source);
  assert.equal(parsed.title, 'Terms');
  assert.equal(readConceptCatalog('# **Project** `terms`\n').title, 'Project terms');
  assert.equal(readFileSync(new URL('../../templates/concepts.md', import.meta.url), 'utf8'), EMPTY_CONCEPT_CATALOG);
  assert.deepEqual(parsed.concepts[0], { id: 'memory', term: 'Memory', definition: 'A **durable** [finding](notes.md) with `code`.', deprecated: [] });
  assert.equal(parsed.concepts.length, 2);
  assert.deepEqual(readConceptCatalog(term('constructor', 'Constructor')).concepts[0]?.deprecated, []);
  for (const [source, line] of [
    ['# Terms\n\n## Missing ID\n\nDefinition.\n', 3],
    ['# Terms\n\n## `Code` {#code}\n\nDefinition.\n', 3],
    ['# Terms\n\n## Term {#term}\n\n- Not a paragraph\n', 5],
    ['# Terms\n\n## Shared language\n\nOld init outline.\n', 3],
    ['# Terms\n\n# Second\n', 3],
    ['## Term {#term}\n\nDefinition.\n\n# Too late\n', 1],
    ['# Terms\n\n## Term {#term}\n\nDefinition.\n\n## Another {#term}\n\nDefinition.\n', 7],
  ] as const) assert.throws(() => readConceptCatalog(source), error => error instanceof Error && 'code' in error && error.code === 'InvalidConceptCatalog' && error.message.includes(`line ${line}:`));
  for (const metadata of ['format: concord.concepts/v1', 'version: 1', 'unknown: true', 'imports: [docs/concepts.md#term, docs/concepts.md#term]', 'deprecated: {missing: [Old]}', 'deprecated: {term: [term]}', 'deprecated: {term: []}', 'deprecated: {term: [Old, old]}', 'imports: [docs/../concepts.md#term]', 'imports: [docs/_template/concepts.md#term]', 'imports: [docs/concepts.json#term]']) {
    assert.throws(() => readConceptCatalog(`---\n${metadata}\n---\n\n${term('term', 'Term')}`), { code: 'InvalidConceptCatalog' });
  }
})));

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
// C1, C2, C4, C15
test('only a term in effective prose counts as usage; catalogs still obey writing rules', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    withRepo(root, repo => {
      writeWritingFile(repo, { roots: ['docs/feature/sample'], bannedTerms: [{ term: 'Forbidden', use: 'Allowed', why: 'fixture' }], }, showWriting(repo).digest);
      const source = '---\ndeprecated:\n  issue: [观察]\n---\n\n# Terms\n\n## Issue {#issue}\n\nAn issue.\n\n### Explanation\n\n`观察` is old. Forbidden.\n';
      writeConceptFile(repo, source, null, false, 'docs/feature/sample/concepts.md');
    });
    write(root, 'docs/feature/sample/page.md', '观察。\n');
    const old = withRepo(root, repo => checkWriting(repo, undefined, false));
    const ban = old.findings.find(item => item.rule === 'bannedTerm' && item.file.endsWith('/page.md'));
    assert.match(ban?.message ?? '', /Issue/u);
    assert.equal(ban?.source?.ref, 'docs/feature/sample/concepts.md#issue');
    assert(old.findings.some(item => item.rule === 'unusedConcept'));
    assert(old.findings.some(item => item.file.endsWith('/concepts.md') && item.rule === 'bannedTerm' && item.message.includes('Forbidden')));
    assert(!old.findings.some(item => item.file.endsWith('/concepts.md') && item.message.includes('观察')));
    write(root, 'docs/feature/sample/page.md', '[Issue](concepts.md#issue).\n');
    assert(!withRepo(root, repo => checkWriting(repo, undefined, false)).findings.some(item => item.rule === 'unusedConcept'));
    write(root, 'docs/feature/sample/page.md', 'A different word.\n');
    assert(withRepo(root, repo => checkWriting(repo, undefined, false)).findings.some(item => item.rule === 'unusedConcept'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('catalog-looking Markdown outside discovery remains ordinary prose for usage', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    withRepo(root, repo => {
      writeWritingFile(repo, { roots: ['docs', 'guide'], bannedTerms: [], }, showWriting(repo).digest);
      writeConceptFile(repo, term('glossary-word', 'GlossaryWord'), showConcepts(repo).digest);
    });
    write(root, 'guide/concepts.md', 'GlossaryWord.\n');
    write(root, 'docs/_template/local/concepts.md', 'Other prose.\n');
    assert(!withRepo(root, repo => checkWriting(repo, undefined, false)).findings.some(item => item.rule === 'unusedConcept'));
    write(root, 'guide/concepts.md', 'Other prose.\n');
    write(root, 'docs/_template/local/concepts.md', 'GlossaryWord.\n');
    assert(!withRepo(root, repo => checkWriting(repo, undefined, false)).findings.some(item => item.rule === 'unusedConcept'));
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
// C5, C6, C9, C10, C14

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
// C3
test('terminology links reuse inline-link filtering and percent decoding', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    const target = 'docs/feature/语言/concepts.md';
    withRepo(root, repo => writeConceptFile(repo, term('memory', 'Memory'), null, false, target));
    write(root, 'docs/links.md', '[Memory](feature/%E8%AF%AD%E8%A8%80/concepts.md#%6demory) [page](feature/语言/concepts.md)\n\n![image](feature/语言/concepts.md#missing)\n\n[ref][reference]\n\n[reference]: feature/语言/concepts.md#missing\n\n`[code](feature/语言/concepts.md#missing)`\n\n<a href="feature/语言/concepts.md#missing">html</a>\n');
    assert.equal(withRepo(root, repo => checkProject(repo, 'off')).findings.filter(item => item.category === 'relation').length, 0);
    write(root, 'docs/links.md', '\n[Memory](feature/语言/concepts.md#memo)\n');
    const broken = withRepo(root, repo => checkProject(repo, 'off')).findings.find(item => item.code === 'AnchorNotFound');
    assert.equal(broken?.line, 2);
    assert.equal(broken?.category, 'relation');
    for (const url of ['feature/语言/concepts.md?view=1#memory', 'feature/语言/concepts.md#%GG']) {
      write(root, 'docs/links.md', `[Memory](${url})\n`);
      const report = withRepo(root, repo => checkProject(repo, 'off'));
      assert.equal(report.complete, false);
      assert(report.findings.some(item => item.category === 'relation' && item.code === 'ConceptLinkInvalid'));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));

// @use-case docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
// C11, C12, C13
test('generic saves permit direct catalog editing and JSON files stay outside terminology discovery', () => Effect.runPromise(Effect.sync(() => {
  const root = fixture();
  try {
    assert.equal(readFileSync(join(root, 'docs/concepts.md'), 'utf8'), EMPTY_CONCEPT_CATALOG);
    assert.equal(existsSync(join(root, 'docs/concepts.json')), false);
    withRepo(root, repo => createDocument(repo, 'feature', { id: 'sample', title: 'Sample', pages: [] }));
    const path = 'docs/feature/sample/concepts.md';
    withRepo(root, repo => addPage(repo, 'feature', 'sample', 'concepts'));
    write(root, path, term('local', 'Local'));
    withRepo(root, repo => setMarkdown(repo, path, term('local', 'Changed'), digest(term('local', 'Local'))));
    assert.equal(readFileSync(join(root, path), 'utf8'), term('local', 'Changed'));
    assert.throws(() => withRepo(root, repo => setMarkdown(repo, path, '# Stale\n', digest(term('local', 'Local')))), { code: 'FileChangedSinceRead' });
    const template = 'docs/_template/concepts.md';
    write(root, template, '# Template\n\n## Outline\n');
    withRepo(root, repo => setMarkdown(repo, template, '# Updated reference\n', digest('# Template\n\n## Outline\n')));
    assert.equal(readFileSync(join(root, template), 'utf8'), '# Updated reference\n');
    rmSync(join(root, path));
    rmSync(join(root, 'docs/concepts.md'));
    write(root, 'docs/concepts.json', 'Deliberately malformed and ignored.');
    assert.deepEqual(withRepo(root, indexConcepts).catalogs, []);
    assert.deepEqual(withRepo(root, indexConcepts).diagnostics, []);
    assert.equal(withRepo(root, showConcepts).state, 'missing');
    const original = LocalRepository.prototype.read;
    class RejectJsonReads extends LocalRepository {
      override read(path: string) { assert(!path.endsWith('/concepts.json')); return original.call(this, path); }
    }
    const repo = new RejectJsonReads(root, { persistentCache: 'off' });
    try { assert.equal(indexConcepts(repo).concepts.length, 0); assert.equal(checkWriting(repo, undefined, false).findings.length, 0); }
    finally { repo.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
