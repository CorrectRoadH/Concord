import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramBlocks, hasStatechartBlock, replaceMarkdownBlock } from '../../web/lib/markdown-blocks.ts';

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md#验收
test('editing a statechart fence keeps frontmatter, surrounding Markdown and duplicate fences byte-for-byte', () => {
  const frontmatter = '---\r\nexample: |\r\n  ~~~statechart spec="example.tla"\r\n  ~~~\r\n---\r\n';
  const fence = '~~~statechart spec="./Recovery.tla" config="./fixed.cfg"\r\n~~~';
  const prefix = frontmatter + '\r\n# 检查 🙂\r\n\r\n' + fence + '\r\n\r\n';
  const suffix = '\r\n\r\n<!-- Keep  -->\r\n\r\n$$x=3$$\r\n';
  const markdown = prefix + fence + suffix;
  assert.equal(hasStatechartBlock(frontmatter), false);
  assert.equal(hasStatechartBlock(markdown), true);
  const blocks = [...diagramBlocks(markdown).values()];
  assert.equal(blocks.length, 2);
  const second = blocks[1]!;
  assert.equal(second.start, prefix.length);
  assert.equal(second.source, fence);
  assert.equal(second.code, '');
  assert.equal(second.meta, 'spec="./Recovery.tla" config="./fixed.cfg"');
  const replacement = fence.replace('fixed.cfg', 'second.cfg');
  assert.equal(replaceMarkdownBlock(markdown, second, replacement), prefix + replacement + suffix);
});
