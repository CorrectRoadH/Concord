import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { projectConceptCatalogs, WorkspaceProjectionSnapshotSchema, type WorkspaceSnapshot } from '../../src/model/index.js';
import { makeWorkspaceProjectionRecord } from '../../src/app/index.js';
import { effectiveConcepts, readConceptCatalog } from '../../src/domain/concepts/index.js';
import { workspaceDisplay, effectiveWorkspaceConcepts, testDeclarationSummary, conceptBody } from '../../src/model/workspace-display/index.js';
import * as webDisplay from '../../web/lib/workspace-display.js';
import { panelDetail, initialPanelState } from '../../src/entry/panel/index.js';
import { panelSnapshot, feature, useCase, featurePath } from '../support/panel-fixture.js';

const a = 'docs/feature/reader/concepts.md', b = 'docs/feature/sibling/concepts.md';
const source = (definition: string) => `# Concepts\n\n## Spec {#spec}\n\n${definition}\n\nExplanation kept in the source body.\n`;
const pages = [{ path: a, body: source('READER_SECRET'), digest: 'a-1', documentPath: featurePath }, { path: b, body: source('SIBLING_SECRET'), digest: 'b-1' }];
const directory = projectConceptCatalogs(pages);
const snapshot = { ...panelSnapshot, pages: [...panelSnapshot.pages, ...pages.map(({ body: _, ...page }) => page)], conceptCatalogs: directory.catalogs };

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('projection builds a strict body-free concept directory from already observed pages', () => Effect.runSync(Effect.sync(() => {
  const full: WorkspaceSnapshot = { ...panelSnapshot, feedback: [], documents: panelSnapshot.documents.flatMap(document => document.metadata.kind === 'feature' || document.metadata.kind === 'use-case' ? [{ ...document, metadata: document.metadata, body: '' }] : []), pages, cache: { status: 'off' }, diagnostics: { error: 'fixture', message: 'fixture' } };
  const record = makeWorkspaceProjectionRecord(full, { files: [], directories: [], publicationChanged: false }, '2026-10-30T00:00:00Z');
  assert.deepEqual(record.snapshot.conceptCatalogs, directory.catalogs);
  assert.doesNotMatch(JSON.stringify(record), /READER_SECRET|SIBLING_SECRET|Explanation kept/u);
  const decode = Schema.decodeUnknownSync(WorkspaceProjectionSnapshotSchema, { onExcessProperty: 'error' });
  assert.throws(() => decode({ ...record.snapshot, conceptCatalogs: [{ ...directory.catalogs[0], body: 'leak' }] }));
  assert.throws(() => decode({ ...record.snapshot, conceptCatalogs: [{ ...directory.catalogs[0], concepts: [{ ...directory.catalogs[0]!.concepts[0], definition: 'leak' }] }] }));
  const invalid = makeWorkspaceProjectionRecord({ ...full, pages: [{ path: a, digest: 'invalid', body: '# invalid\n\n## Missing anchor\n\nDefinition' }] }, { files: [], directories: [], publicationChanged: false }, '2026-10-30T00:00:00Z');
  assert.equal(invalid.complete, false); assert.equal(invalid.snapshot.findings[0]?.code, 'InvalidConceptCatalog');
})));

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('domain, Web and panel share directory scope selection, including imports and deprecated spelling', () => Effect.runSync(Effect.sync(() => {
  const catalogs = pages.map(page => ({ path: page.path, digest: page.digest, scope: page.path.slice(0, -'/concepts.md'.length), catalog: readConceptCatalog(page.body) }));
  const path = 'docs/feature/reader/use-case/read.md';
  const projected = effectiveWorkspaceConcepts(snapshot, path);
  assert.deepEqual(projected.map(item => item.path), [a]);
  assert.deepEqual(projected, webDisplay.effectiveWorkspaceConcepts(snapshot, path));
  assert.deepEqual(projected.map(item => item.reference), effectiveConcepts(path, catalogs).map(item => item.reference));
  assert.deepEqual(effectiveWorkspaceConcepts(snapshot, 'docs/feature/sibling/README.md').map(item => item.path), [b]);
  const importer = { path: 'docs/engineering/example/concepts.md', imports: [`${b}#spec`], concepts: [] };
  assert.deepEqual(effectiveWorkspaceConcepts({ ...snapshot, conceptCatalogs: [...snapshot.conceptCatalogs, importer] }, 'docs/engineering/example/README.md').map(item => item.path), [b]);
  const deprecated = projectConceptCatalogs([{ path: a, body: '---\ndeprecated:\n  spec: [OldSpec]\n---\n' + source('definition') }]);
  assert.deepEqual(deprecated.catalogs[0]?.concepts[0], { id: 'spec', term: 'Spec', deprecated: ['OldSpec'] });
})));

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('concept detail reads the matching catalog section with its explanation and excludes its neighbour', () => Effect.runSync(Effect.sync(() => {
  const model = workspaceDisplay(snapshot), concept = effectiveWorkspaceConcepts(snapshot, featurePath)[0]!;
  const state = { ...initialPanelState, selected: featurePath, category: 'feature', focus: 'body' as const, concept };
  const body = source('READER_SECRET') + '\n## Other {#other}\n\nNot this concept.';
  const props = { model, state, columns: 80, rows: 24, bodies: new Map([[a, { path: a, digest: 'a-1', body, model }]]) };
  assert.match(conceptBody(body, 'spec')!, /Explanation kept/u);
  const text = panelDetail(props).lines.map(line => line.text).join('\n');
  assert.match(text, /READER_SECRET/u); assert.match(text, /Explanation kept/u); assert.doesNotMatch(text, /Not this concept/u);
  assert.match(panelDetail({ ...props, bodies: new Map() }).lines.map(line => line.text).join('\n'), /概念正文正在更新/u);
})));

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('Feature counts declarations across its pages and Use Cases and lists Use Cases without declarations', () => Effect.runSync(Effect.sync(() => {
  const empty = { ...useCase, path: 'docs/feature/reader/use-case/empty.md', metadata: { ...useCase.metadata, id: 'empty', title: 'Empty flow' } };
  const model = { ...snapshot, documents: [...snapshot.documents, empty] };
  const summary = testDeclarationSummary(model, feature);
  assert.equal(summary.count, 2); assert.deepEqual(summary.untestedUseCases.map(item => item.path), [empty.path]);
  assert.deepEqual(summary, webDisplay.testDeclarationSummary(model, feature));
  const display = workspaceDisplay(model), text = panelDetail({ model: display, columns: 80, rows: 40, state: { ...initialPanelState, selected: featurePath }, bodies: new Map([[featurePath, { path: featurePath, digest: feature.digest, body: '# Feature', model: display }]]) }).lines.map(line => line.text).join('\n');
  assert.match(text, /测试声明：2 项/u); assert.match(text, /未关联测试的 Use Case：Empty flow/u);
  assert.doesNotMatch(text, /运行状态|收据|通过|失败|过期/u);
})));
