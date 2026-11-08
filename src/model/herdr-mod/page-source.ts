// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md#原位预览
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Code, Definition, Image, ImageReference, Nodes } from 'mdast';

export interface SourceBlock {
  readonly start: number;
  readonly end: number;
  readonly literal: boolean;
}
export interface SpecialSource extends SourceBlock {
  readonly node: Image | ImageReference | Code;
  readonly source: string;
}

/** Positions refer to the original string; never serialize the syntax tree. */
export function pageSource(source: string): { blocks: SourceBlock[]; special: SpecialSource[]; definitions: string } {
  const root = fromMarkdown(source);
  const definitions = new Map<string, Definition>();
  const visit = (node: Nodes, callback: (node: Nodes) => void): void => {
    callback(node);
    if ('children' in node) for (const child of node.children) visit(child, callback);
  };
  visit(root, node => { if (node.type === 'definition') definitions.set(node.identifier.toLowerCase(), node); });
  const frontmatter = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?=\r?\n|$)/u.exec(source)?.[0].length ?? 0;
  const blocks: SourceBlock[] = frontmatter ? [{ start: 0, end: frontmatter, literal: true }] : [];
  for (const node of root.children) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < frontmatter) continue;
    blocks.push({ start, end, literal: node.type === 'definition' || node.type === 'html' });
  }
  if (!blocks.length) blocks.push({ start: 0, end: source.length, literal: false });
  const special: SpecialSource[] = [];
  visit(root, node => {
    if (node.type !== 'image' && node.type !== 'imageReference' && !(node.type === 'code' && (node.lang === 'mermaid' || node.lang === 'p5'))) return;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined || start < frontmatter) return;
    const value = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier.toLowerCase())?.url ?? node.identifier : node.value;
    special.push({ node, source: value, start, end, literal: false });
  });
  return {
    blocks, special: special.sort((a, b) => a.start - b.start),
    definitions: [...definitions.values()].map(node => source.slice(node.position?.start.offset, node.position?.end.offset)).join('\n'),
  };
}
