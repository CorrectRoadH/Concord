import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { rebaseAdoptedMarkdown } from "../../src/domain/documents/index.ts";

const rebase = (source: string) => rebaseAdoptedMarkdown(source, 'docs/roadmap/session/README.md', 'docs/feature/session/README.md', 'docs/roadmap/session');

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('rebases actual links next to code and follows internal destinations to their new copy', () => Effect.runPromise(Effect.sync(() => {
 const source = '`[example](../other/README.md)` and [real](../other/README.md#goal)\n[local](../../roadmap/session/nested/guide.md)\n[reference][other]\n\n[other]: ../other/README.md\n';
 assert.equal(rebase(source), '`[example](../other/README.md)` and [real](../../roadmap/other/README.md#goal)\n[local](nested/guide.md)\n[reference][other]\n\n[other]: ../../roadmap/other/README.md\n');
})));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('code fences, inline code, and indented examples preserve their bytes', () => Effect.runPromise(Effect.sync(() => {
 const source = '````md\n```\n<a href="../other">example</a>\n[example](../other/README.md)\n````\n~~~md\n![asset](../asset.svg)\n~~~\n\t[example](../other/README.md)\n`<img src="../asset.svg">`\n';
 assert.equal(rebase(source), source);
})));

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('adoption shares parsed destination relocation and preserves unrelated HTML and invalid link syntax', () => Effect.runPromise(Effect.sync(() => {
 assert.equal(rebase('[ref](../other/README.md "title")\n'), '[ref](../../roadmap/other/README.md "title")\n');
 assert.equal(rebase('[ref]:\n  ../other/README.md\n'), '[ref]:\n  ../../roadmap/other/README.md\n');
 assert.equal(rebase('<img src="../asset.svg">\n'), '<img src="../asset.svg">\n');
 assert.throws(() => rebase('![a [b]](../other.md)\n'), { code: 'UnsupportedMarkdownLink' });
})));
