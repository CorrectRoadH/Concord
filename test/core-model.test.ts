import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { decodeDocumentSource } from "../src/domain/documents/index.js";
import { renderDocument } from "../src/model/index.js";
import { researchSources } from "../src/model/index.js";
import { activateMemory, adoptRoadmap, checkDocuments, createDocument, decideDesign, deferDesign, findDocument, linkIssue, loadDocuments, linkMemory, supersedeMemory, unlinkIssue } from "../src/domain/documents/index.js";
import { LocalRepository, initialize } from "../src/base/workspace/index.js";
import { type DocumentMeta } from "../src/model/index.js";
import { authorDesignFixture } from './design-fixture.js';
import { renderMemorySource } from "../src/domain/memory/index.js";
import { withConsumer as consumer } from './support/consumer.js';

const base = { format: 'concord.document/v1' as const, id: 'sample', title: '样例', createdAt: '2026-10-30' };
const issue = { ...base, kind: 'issue' as const, status: 'open' as const, relations: [] };
const memory = { ...base, kind: 'memory' as const, type: 'insight' as const, status: 'captured' as const, relations: [] };
const frontmatter = (source: string): unknown => parse(/^---\n([\s\S]*?)\n---/u.exec(source)![1]!);
const code = (name: string) => (cause: unknown): boolean => cause instanceof Error && 'code' in cause && cause.code === name;
const write = (root: string, path: string, source: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#路径与身份
test('identity comes from canonical paths and the unique Markdown H1, preserving Unicode', () => {
  const { createdAt: _createdAt, ...identity } = base;
  const source = renderDocument({ ...identity, kind: 'use-case', feature: 'docs/feature/ignored/README.md' }, '# café **标题**\n\n```md\n# 代码不是名称\n```\n');
  const record = decodeDocumentSource('docs/feature/实际/use-case/创建.md', source)!;
  assert.equal(record.metadata.id, '创建'); assert.equal(record.metadata.title, 'café 标题');
  assert.equal(record.metadata.kind, 'use-case');
  if (record.metadata.kind === 'use-case') assert.equal(record.metadata.feature, 'docs/feature/实际/README.md');
  assert.equal(source.startsWith('---'), false);
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#名称
test('malformed owners and obsolete metadata are named invalid inputs', () => {
  const invalid = [
    ['docs/feature/a/README.md', '---\ntitle: duplicate\n---\n# Name\n'],
    ['docs/feature/a/README.md', '# One\n\n# Two\n'],
    ['docs/feature/a/README.md', '```md\n# Not a heading\n```\n'],
    ['docs/feature/a/README.md', `# ${'x'.repeat(1025)}\n`],
    ['docs/feature/a/README.md', 'Long\nname\n====\n'],
    ['docs/issues/a.md', '---\nstatus: open\nid: a\n---\n# Issue\n'],
    ['docs/issues/a.md', '---\nstatus: open\nrelations: []\n---\n# Issue\n'],
    ['memory/a.md', '---\ntype: problem\nstatus: captured\n---\n# Memory\n'],
    ['memory/a.md', '---\ntype: note\nstatus: current\n---\n# Memory\n'],
    ['memory/a.md', '---\ntype: insight\nstatus: current\nrelations:\n  - role: supports\n    target: docs/issues/a.md\n---\n# Memory\n'],
    ['docs/issues/a.md', '---\nstatus: open\nrelations:\n  - role: related\n    target: memory/a.md\n---\n# Issue\n'],
    ['docs/issues/a.md', '---\nstatus: open\nrelations:\n  - role: delivery\n    target: memory/a.md\n---\n# Issue\n'],
  ] as const;
  for (const [path, source] of invalid) assert.throws(() => decodeDocumentSource(path, source), code('InvalidData'), `${path}: ${source}`);
});

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
test('Issue serializes only nonempty declarations and structurally validates fixed verification', () => {
  assert.deepEqual(frontmatter(renderDocument(issue, '# Issue\n')), { status: 'open' });
  const verification = { defect: 'a'.repeat(40), fix: 'b'.repeat(40), tests: ['neref_test'] as [string], runner: `sha256:${'c'.repeat(64)}`, concord: '0.4.0' };
  const metadata: DocumentMeta = { ...issue, status: 'closed', closure: { kind: 'fixed', reason: '修正', verification } };
  const source = renderDocument(metadata, '# Issue\n');
  assert.deepEqual(frontmatter(source), { status: 'closed', closure: { kind: 'fixed', reason: '修正', verification } });
  assert.deepEqual(decodeDocumentSource('docs/issues/a.md', source)?.metadata.kind, 'issue');
  assert.throws(() => decodeDocumentSource('docs/issues/a.md', source.replace('runner:', 'runnerDigest:')), code('InvalidData'));
});

// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
test('Memory writes type, status and relations without lifecycle history or derived identity', () => {
  assert.deepEqual(frontmatter(renderDocument(memory, '# Insight\n')), { type: 'insight', status: 'captured' });
  const source = renderDocument({ ...memory, status: 'current', relations: [{ role: 'supports', target: 'docs/feature/a/README.md' }] }, '# Insight\n');
  assert.deepEqual(frontmatter(source), { type: 'insight', status: 'current', relations: [{ role: 'supports', target: 'docs/feature/a/README.md' }] });
});

// @use-case docs/feature/document-packages/use-case/organize-freeform-research.md
test('Research sources and observed date belong to its Sources section', () => {
  const source = renderDocument({ ...base, kind: 'research', observedAt: '2026-10-30', sources: ['https://example.invalid/paper'] }, '# Research\n');
  assert.equal(source.startsWith('---'), false);
  assert.deepEqual(researchSources(source), { observedAt: '2026-10-30', sources: ['https://example.invalid/paper'] });
  assert.deepEqual(researchSources('# Topic\n\n```md\n## Sources\n- Source: false\n```\n\n## 来源\n\n- Observed at: 2026-10-30\n- Source: [证据](https://example.invalid/evidence)\n'), { observedAt: '2026-10-30', sources: ['https://example.invalid/evidence'] });
});

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
test('constitution Memory rendering uses the same AST heading validation as other Memory writers', () => {
  const source = renderMemorySource(memory, '```md\n# Example heading\n```\n');
  assert.equal(decodeDocumentSource('memory/sample.md', source)?.metadata.title, '样例');
  assert.throws(() => renderMemorySource(memory, '# First\n\n# Second\n'), code('InvalidData'));
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#路径与身份
test('same Use Case filename in different Features requires an exact selector', () => Effect.runPromise(Effect.sync(() => consumer(repo => {
  for (const id of ['one', 'two']) { createDocument(repo, 'feature', { id, title: id }); createDocument(repo, 'use-case', { id: 'create', title: '创建', feature: id }); }
  const documents = loadDocuments(repo);
  assert.throws(() => findDocument(documents, 'create', 'use-case'), code('AmbiguousDocument'));
  assert.equal(findDocument(documents, 'docs/feature/two/use-case/create.md', 'use-case').path, 'docs/feature/two/use-case/create.md');
  assert.deepEqual(checkDocuments(repo, documents), []);
}))));

// @use-case docs/feature/local-sdlc/use-case/compare-design-plans.md
test('Design derives candidates and writes Selected and Deferred declarations in DECISION', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  createDocument(repo, 'design', { id: 'storage', title: 'Storage', alternatives: ['local', 'remote'] });
  authorDesignFixture(root, 'storage', ['local', 'remote'], 'local');
  const path = 'docs/design/storage/DECISION.md';
  write(root, path, readFileSync(join(root, path), 'utf8').replace(/^Selected:.*\n/mu, ''));
  const before = repo.read('docs/design/storage/README.md');
  deferDesign(repo, 'storage', '等待输入');
  const deferred = findDocument(loadDocuments(repo), 'storage', 'design');
  assert.equal(deferred.metadata.kind === 'design' && deferred.metadata.deferral?.reason, '等待输入');
  decideDesign(repo, 'storage', 'local', [], '采用本地存储');
  assert.equal(repo.read('docs/design/storage/README.md'), before);
  assert.match(repo.read(path)!, /Selected: \[local\]\(plans\/local\/README\.md\)/u);
  assert.doesNotMatch(repo.read(path)!, /^Deferred:/mu);
  const record = findDocument(loadDocuments(repo), 'storage', 'design');
  assert.deepEqual(record.metadata.kind === 'design' && record.metadata.alternatives, ['local', 'remote']);
  assert.throws(() => decideDesign(repo, 'storage', 'remote', [], '改选'), code('DecisionExists'));
}))));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
test('Roadmap adoption moves the package and rewrites inbound and outbound Markdown links', () => Effect.runPromise(Effect.sync(() => consumer((repo, root) => {
  createDocument(repo, 'feature', { id: 'existing', title: 'Existing' });
  createDocument(repo, 'roadmap', { id: 'future', title: 'Future', body: '# Future\n\n[guide](guide.md) [existing](../../feature/existing/README.md)\n' });
  write(root, 'docs/roadmap/future/guide.md', '# Guide\n\n[owner](README.md)\n');
  write(root, 'docs/feature/existing/inbound.md', '# Inbound\n\n[future](../../roadmap/future/guide.md)\n');
  adoptRoadmap(repo, 'future', 'future');
  assert.equal(repo.read('docs/roadmap/future/README.md'), undefined);
  assert.equal(repo.read('docs/roadmap/future/guide.md'), undefined);
  assert.equal(existsSync(join(root, 'docs/roadmap/future')), false);
  assert.equal(repo.read('docs/feature/future/guide.md'), '# Guide\n\n[owner](README.md)\n');
  assert.match(repo.read('docs/feature/existing/inbound.md')!, /\]\(\.\.\/future\/guide\.md\)/u);
  assert.match(repo.read('docs/feature/future/README.md')!, /\]\(\.\.\/existing\/README\.md\)/u);
}))));

// @use-case docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
test('Issue links validate role targets and unlink removes only that relation', () => Effect.runPromise(Effect.sync(() => consumer(repo => {
  createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
  for (const id of ['one', 'two']) createDocument(repo, 'issue', { id, title: id });
  createDocument(repo, 'memory', { id: 'note', title: 'Insight', memoryKind: 'insight' });
  assert.throws(() => linkIssue(repo, 'one', 'memory/note.md'), code('InvalidMemoryState'));
  activateMemory(repo, 'note', '确认结论');
  linkIssue(repo, 'one', 'memory/note.md', false, 'root-cause');
  linkIssue(repo, 'one', 'docs/issues/two.md', false, 'related');
  linkIssue(repo, 'one', 'docs/feature/sample/README.md', false, 'adopts');
  unlinkIssue(repo, 'one', 'memory/note.md', false, 'root-cause');
  assert.deepEqual(frontmatter(repo.read('docs/issues/one.md')!), { status: 'open', relations: [{ role: 'related', target: 'docs/issues/two.md' }, { role: 'adopts', target: 'docs/feature/sample/README.md' }] });
  assert.deepEqual(checkDocuments(repo, loadDocuments(repo)), []);
}))));
