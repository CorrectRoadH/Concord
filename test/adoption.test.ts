import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { rebaseAdoptedMarkdown } from '../dist/adoption.js';

const rebase = (source: string) => rebaseAdoptedMarkdown(source, 'docs/roadmap/session/README.md', 'docs/feature/session/README.md', 'docs/roadmap/session');

// @concord-case adoption-rebases-safe-links
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('rebases actual links next to code and follows internal destinations to their new copy', () => Effect.runPromise(Effect.sync(() => {
 const source = '`[example](../other/README.md)` and [real](../other/README.md#goal)\n[local](../../roadmap/session/nested/guide.md)\n[reference][other]\n[other]: ../other/README.md\n';
 assert.equal(rebase(source), '`[example](../other/README.md)` and [real](../../roadmap/other/README.md#goal)\n[local](nested/guide.md)\n[reference][other]\n[other]: ../../roadmap/other/README.md\n');
})));

// @concord-case adoption-preserves-code-examples
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('code fences, inline code, and indented examples preserve their bytes', () => Effect.runPromise(Effect.sync(() => {
 const source = '````md\n```\n<a href="../other">example</a>\n[example](../other/README.md)\n````\n~~~md\n![asset](../asset.svg)\n~~~\n\t[example](../other/README.md)\n`<img src="../asset.svg">`\n';
 assert.equal(rebase(source), source);
})));

// @concord-case adoption-rejects-ambiguous-links
// @concord-contract docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('complex prose destinations are rejected instead of silently retaining an incorrect relative target', () => Effect.runPromise(Effect.sync(() => {
 for (const source of ['[ref]: ../other/README.md "title"\n', '[ref]:\n  ../other/README.md\n', '[ref](../other/README.md "title")\n', '<img src="../asset.svg">\n', '[ref](../other(a).md)\n', '[ref](../other%20file.md)\n', '[ref]\n(../other.md)\n', '`unclosed [ref](../other.md)\n', '> [ref]: ../other.md\n', '[[nested]](../other.md)\n', '\\`literal [ref](../other.md)`\n']) {
  assert.throws(() => rebase(source), { code: 'UnsupportedMarkdownLink' });
 }
})));
