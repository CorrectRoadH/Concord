import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { DOCUMENT_NAME_PATTERN, fromMarkdown, headingAnchorsFromTree, markdown_facts_markdownAnchor, ref_markdownAnchor } from '../../src/model/index.ts';

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md
test('explicit heading IDs preserve document-name Unicode spelling across reference parsers', () => Effect.runPromise(Effect.sync(() => {
  for (const id of ['主流程', '配置与结果', '结果-2', 'e\u0301', 'é', '123', 'Title-ID']) {
    assert.equal(DOCUMENT_NAME_PATTERN.test(id), true, id);
    const source = `## Visible title {#${id}}\n`;
    assert.equal(markdown_facts_markdownAnchor(source.trim()), id, id);
    assert.equal(ref_markdownAnchor(source.trim()), id, id);
    assert.equal(headingAnchorsFromTree(source, fromMarkdown(source)).has(id), true, id);
  }
  for (const id of ['-leading', 'trailing-', 'two--parts', 'under_score', 'with:colon', 'dot.id']) {
    assert.equal(DOCUMENT_NAME_PATTERN.test(id), false, id);
    const source = `## Visible title {#${id}}\n`;
    assert.equal(markdown_facts_markdownAnchor(source.trim()), undefined, id);
    assert.equal(ref_markdownAnchor(source.trim()), undefined, id);
    assert.equal(headingAnchorsFromTree(source, fromMarkdown(source)).has(id), false, id);
  }
})));
