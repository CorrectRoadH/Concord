import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { Effect } from 'effect';
import stringWidth from 'string-width';
import { workspaceDisplay } from '../../src/model/workspace-display/index.js';
import { panelDetail, plainPanelFrame, markdownToTerminal, initialPanelState, reconcilePanelState, navigatePanel, panelItems, wrapTerminalLine, sliceColumns, panelWorktree, type PanelState, type BoundPanelBody } from '../../src/entry/panel/index.js';
import { PanelView } from '../../src/entry/panel/view.js';
import { panelSnapshot, panelBody, featurePath, useCasePath } from '../support/panel-fixture.js';
const model = workspaceDisplay(panelSnapshot);
const concept = { id: 'spec', term: 'Spec', digest: 'catalog-1', deprecated: ['旧规范'], path: 'docs/feature/reader/concepts.md' };
const accepted: BoundPanelBody = { path: featurePath, digest: 'feature-1', body: panelBody, model };
const bodies = new Map([[featurePath, accepted]]);
const state: PanelState = { ...initialPanelState, category: 'feature', selected: featurePath, focus: 'body' };
const props = { model, state, bodies, columns: 100, rows: 26, noColor: true };

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md
test('plain and Ink first frames share body, navigation, wrapping and narrow layouts', () => {
  const normalize = (text: string) => text.split('\n').map(line => line.trimEnd()).join('\n').trimEnd();
  for (const columns of [100, 59, 36]) for (const focus of ['navigation', 'body'] as const) {
    const frame = { ...props, columns, state: { ...state, focus } };
    assert.equal(normalize(plainPanelFrame(frame)), normalize(renderToString(createElement(PanelView, frame), { columns })));
  }
});

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('real React terminal renderer changes from two columns at 60 to one at 59 and respects NO_COLOR', () => Effect.runSync(Effect.sync(() => {
  const wide = renderToString(createElement(PanelView, { ...props, columns: 60 }), { columns: 60 });
  const narrow = renderToString(createElement(PanelView, { ...props, columns: 59 }), { columns: 59 });
  assert.match(wide, /│/u); assert.doesNotMatch(narrow, /│/u);
  assert.match(wide, /已连接/u); assert.match(narrow, /阅读 Spec/u);
  assert.doesNotMatch(wide, /\x1b/u);
  assert.equal(props.state.selected, featurePath);
  for (const line of narrow.split('\n')) assert.ok(stringWidth(line) <= 59, line);
  const disconnected = renderToString(createElement(PanelView, { ...props, connection: 'reconnecting' }), { columns: 100 });
  assert.match(disconnected, /重连中/u); assert.match(disconnected, /阅读 Spec/u);
  const pending = renderToString(createElement(PanelView, { ...props, model: undefined }), { columns: 100 });
  assert.match(pending, /构建中/u);
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('body digest mismatch retains a previously matched body with its old relationships', () => Effect.runSync(Effect.sync(() => {
  const newer = workspaceDisplay({ ...panelSnapshot, documents: panelSnapshot.documents.map(document => document.path === featurePath ? { ...document, digest: 'feature-2' } : document), codes: [], cases: [] });
  const retained = panelDetail({ ...props, model: newer });
  assert.match(retained.lines.map(line => line.text).join('\n'), /保留上次匹配的正文与关系/u);
  assert.match(retained.lines.map(line => line.text).join('\n'), /readBody/u);
  const waiting = panelDetail({ ...props, model: newer, bodies: new Map() });
  assert.deepEqual(waiting.lines.map(line => line.text), ['阅读 Spec', '正文正在更新…']);
  const fresh = panelDetail({ ...props, model: newer, bodies: new Map([[featurePath, { ...accepted, digest: 'feature-2', model: newer }]]) });
  assert.doesNotMatch(fresh.lines.map(line => line.text).join('\n'), /src\/reader\.ts/u);
})));

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md#验收
test('generation replacement preserves selected paths and per-item scroll, then falls back to owner or first item', () => Effect.runSync(Effect.sync(() => {
  const selected: PanelState = { ...state, selected: useCasePath, scroll: { [useCasePath]: { row: 19, column: 8 } } };
  assert.equal(reconcilePanelState(selected, model, workspaceDisplay(panelSnapshot)), selected);
  const withoutChild = workspaceDisplay({ ...panelSnapshot, documents: [panelSnapshot.documents[0]!] });
  const parent = reconcilePanelState(selected, model, withoutChild);
  assert.equal(parent.selected, featurePath); assert.equal(parent.scroll[useCasePath]?.row, 19);
  const withoutOwners = workspaceDisplay({ ...panelSnapshot, documents: [], cases: [], codes: [], pages: [{ path: 'docs/README.md', digest: 'a' }] });
  assert.equal(reconcilePanelState(parent, withoutChild, withoutOwners).selected, 'docs/README.md');
  const followed = navigatePanel(selected, featurePath, model);
  assert.equal(followed.history.at(-1)?.selected, useCasePath); assert.deepEqual(followed.scroll, selected.scroll);
})));

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('Markdown AST renders headings, lists, tables, safe links, code and scoped concepts without executing diagrams', () => Effect.runSync(Effect.sync(() => {
  const markdown = markdownToTerminal(panelBody + '\n\n旧规范 specs\n\n[失效](missing.md) [外部](https://example.com)\n\n\u001b[31munsafe', featurePath, new Set(panelItems(model).map(item => item.path)), [concept]);
  const text = markdown.lines.map(line => line.text).join('\n');
  assert.match(text, /# 阅读 Spec/u); assert.match(text, /1\. 打开正文/u); assert.match(text, /`readBody`/u);
  assert.match(text, /\| 项目 \| 状态 \|/u); assert.equal(text.match(/在 Web 中查看/gu)?.length, 2);
  assert.match(text, /function setup\(\)/u); assert.match(text, /flowchart LR/u);
  assert.match(text, /Spec〔概念1〕/u); assert.match(text, /旧规范〔概念1：弃用→Spec〕 specs/u);
  assert.deepEqual(markdown.concepts, [concept]);
  assert.deepEqual(markdown.links, [{ label: '正文', target: useCasePath }]);
  assert.match(text, /失效 \(missing\.md\)/u); assert.match(text, /外部 \(https:\/\/example.com\)/u);
  assert.doesNotMatch(text, /\x1b/u);
  const reference = markdownToTerminal('---\ntitle: hidden\n---\n# Body\n\n[阅读][read]\n\n[read]: use-case/read.md', featurePath, new Set([useCasePath]));
  assert.deepEqual(reference.links, [{ label: '阅读', target: useCasePath }]);
  assert.doesNotMatch(reference.lines.map(line => line.text).join('\n'), /hidden/u);
  const sibling = markdownToTerminal('Spec', 'docs/feature/sibling/README.md', new Set(), [{ ...concept, path: 'docs/feature/sibling/concepts.md' }]);
  assert.equal(sibling.concepts[0]?.path, 'docs/feature/sibling/concepts.md');
  assert.deepEqual(wrapTerminalLine({ text: '0123456789', literal: true }, 4, 3), ['3456']);
  assert.deepEqual(wrapTerminalLine({ text: '中文abcdef' }, 6), ['中文ab', 'cdef']);
  assert.equal(sliceColumns('😀中文', 2, 4), '中文');
})));

// @use-case docs/feature/herdr-panel/use-case/read-spec-detail.md#验收
test('support pages and source ranges remain navigable, diagnostics stay local, missing Herdr cwd is named', () => Effect.runSync(Effect.sync(() => {
  assert.ok(panelItems(model).some(item => item.path === 'docs/feature/reader/architecture.md' && item.parent === featurePath));
  const sourcePath = 'src/reader.ts#L2';
  const source = panelDetail({ ...props, state: { ...state, selected: sourcePath }, bodies: new Map([[sourcePath, { ...accepted, path: sourcePath, digest: 'source-1', body: 'before\nfunction readBody() {\n  return 1;\n}\nafter\noutside' }]]) });
  assert.match(source.lines.map(line => line.text).join('\n'), /2  function readBody/u);
  assert.doesNotMatch(source.lines.map(line => line.text).join('\n'), /outside|before/u);
  const invalid = workspaceDisplay({ ...panelSnapshot, findings: [{ path: 'docs/feature/broken/README.md', code: 'InvalidDocument', message: 'owner metadata invalid' }] });
  assert.ok(panelItems(invalid).some(item => item.path === 'docs/feature/broken/README.md'));
  const diagnostics = panelDetail({ ...props, model: invalid, state: { ...state, selected: 'docs/feature/broken/README.md' } });
  assert.match(diagnostics.lines.map(line => line.text).join('\n'), /InvalidDocument：owner metadata invalid/u);
  const error = Effect.runSync(panelWorktree({ focused_pane_id: 'p1' }).pipe(Effect.flip));
  assert.equal(error._tag, 'PanelWorktreeUnknown');
  assert.deepEqual(Effect.runSync(panelWorktree({ focused_pane_id: 'p1', focused_pane_cwd: '/worktree', extra: true })), { cwd: '/worktree', targetPaneId: 'p1' });
})));
