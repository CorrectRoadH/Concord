import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import type { Nodes } from 'mdast';
import { remarkMathNodes } from '../components/markdown-math.ts';

export interface MarkdownSourceRange {
  readonly start: number;
  readonly end: number;
  readonly source: string;
}
interface DiagramBlock extends MarkdownSourceRange {
  readonly language: string;
  readonly code: string;
  readonly meta: string;
}

export const markdownRemarkPlugins = [remarkGfm, remarkFrontmatter, remarkMath, remarkMathNodes];
const parser = unified().use(remarkParse).use(markdownRemarkPlugins).freeze();

export function diagramBlocks(markdown: string): ReadonlyMap<number, DiagramBlock> {
  const blocks = new Map<number, DiagramBlock>();
  const visit = (node: Nodes): void => {
    if (node.type === 'code') {
      const language = node.lang?.toLowerCase();
      const start = node.position?.start.offset, end = node.position?.end.offset;
      if (start !== undefined && end !== undefined && language && (node.lang === 'p5' || node.lang === 'statechart' || language === 'mermaid')) {
        blocks.set(start, { language, code: node.value, meta: node.meta ?? '', start, end, source: markdown.slice(start, end) });
      }
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(parser.parse(markdown));
  return blocks;
}

export function hasStatechartBlock(markdown: string): boolean {
  return markdown.includes('statechart') && [...diagramBlocks(markdown).values()].some(block => block.language === 'statechart');
}

export function replaceMarkdownBlock(markdown: string, range: MarkdownSourceRange, value: string): string {
  if (markdown.slice(range.start, range.end) !== range.source) return markdown;
  return markdown.slice(0, range.start) + value + markdown.slice(range.end);
}
