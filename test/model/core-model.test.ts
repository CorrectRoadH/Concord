import { createDocument, initialize } from '../support/operations.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.js';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { Effect } from 'effect';
import { parse } from 'yaml';
import { decodeDocumentSource } from "../../src/domain/documents/index.js";
import { renderDocument } from "../../src/model/index.js";
import { checkDocuments, findDocument, loadDocuments } from "../../src/domain/documents/index.js";
import { adoptRoadmap } from "../../src/app/index.js";

import { linkIssue, unlinkIssue } from "../../src/domain/issues/index.js";
import { linkMemory } from "../../src/app/index.js";
import { LocalRepository } from "../support/repository.js";

import { type DocumentMeta } from "../../src/model/index.js";
import { withConsumer as consumer } from '../support/consumer.js';

const base = { format: 'concord.document/v1' as const, id: 'sample', title: '样例' };
const issue = { ...base, kind: 'issue' as const, relations: [] };
const memory = { ...base, kind: 'memory' as const, relations: [] };
const frontmatter = (source: string): unknown => parse(/^---\n([\s\S]*?)\n---/u.exec(source)![1]!);
const code = (name: string) => (cause: unknown): boolean => cause instanceof Error && 'code' in cause && cause.code === name;
const write = (root: string, path: string, source: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); };

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#路径与身份
test('identity comes from canonical paths and the unique Markdown H1, preserving Unicode', () => {
  const identity = base;
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


// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
test('Memory serializes only nonempty supports relations', () => {
  assert.equal(renderDocument(memory, '# Insight\n'), '# Insight\n');
  const source = renderDocument({ ...memory, relations: [{ role: 'supports', target: 'docs/feature/a/README.md' }] }, '# Insight\n');
  assert.deepEqual(frontmatter(source), { relations: [{ role: 'supports', target: 'docs/feature/a/README.md' }] });
});


// @use-case docs/feature/taste/use-case/cite-taste.md
test('taste Memory rendering uses the same AST heading validation as other Memory writers', () => {
  const source = renderDocument(memory, '```md\n# Example heading\n```\n');
  assert.equal(decodeDocumentSource('memory/sample.md', source)?.metadata.title, '样例');
  assert.throws(() => renderDocument(memory, '# First\n\n# Second\n'), code('InvalidData'));
});

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#路径与身份
test('same Use Case filename in different Features requires an exact selector', () => Effect.runPromise(Effect.sync(() => consumer(repo => {
  for (const id of ['one', 'two']) { createDocument(repo, 'feature', { id, title: id }); createDocument(repo, 'use-case', { id: 'create', title: '创建', feature: id }); }
  const documents = loadDocuments(repo);
  assert.throws(() => findDocument(documents, 'create', 'use-case'), code('AmbiguousDocument'));
  assert.equal(findDocument(documents, 'docs/feature/two/use-case/create.md', 'use-case').path, 'docs/feature/two/use-case/create.md');
  assert.deepEqual(checkDocuments(repo, documents), []);
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
