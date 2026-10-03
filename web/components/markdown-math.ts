import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// Use the parser's public tree type, including the installed MDX augmentations.
type HastRoot = Parameters<ReturnType<typeof rehypeRaw>>[0];
type HastContent = HastRoot['children'][number];
type Element = Extract<HastContent, { type: 'element' }>;

const parser = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMath);

function visitMarkdown(node: MdastRoot | MdastContent, visit: (node: MdastRoot | MdastContent) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) visitMarkdown(child, visit);
}

/** Detect actual math syntax, never dollar signs inside code or frontmatter. */
export function hasMarkdownMath(markdown: string): boolean {
  let found = false;
  visitMarkdown(parser.parse(markdown), node => {
    if (node.type === 'math' || node.type === 'inlineMath') found = true;
  });
  return found;
}

/** These private tags exist before raw HTML is parsed, so authors cannot forge them. */
export function remarkMathNodes() {
  return (tree: MdastRoot): void => visitMarkdown(tree, node => {
    if (node.type !== 'math' && node.type !== 'inlineMath') return;
    node.data = {
      ...node.data,
      hName: node.type === 'math' ? 'concord-display-math' : 'concord-inline-math',
      hProperties: {},
      hChildren: [{ type: 'text', value: node.value }],
    };
  });
}

function visitElements(node: HastRoot | HastContent, visit: (node: Element) => void): void {
  if (node.type === 'element') visit(node);
  if ('children' in node) for (const child of node.children) visitElements(child, visit);
}

/** Sanitize author HTML first; render only parser-proven math in isolated trees. */
export function rehypeSafeMath() {
  return (tree: HastRoot): HastRoot => {
    const formulas = new Map<number, { end: number; display: boolean; value: string }>();
    visitElements(tree, node => {
      if (node.tagName !== 'concord-display-math' && node.tagName !== 'concord-inline-math') return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const text = node.children[0];
      if (start === undefined || end === undefined || text?.type !== 'text') return;
      const display = node.tagName === 'concord-display-math';
      formulas.set(start, { end, display, value: text.value });
      node.tagName = display ? 'div' : 'span';
    });
    const safe = unified().use(rehypeRaw).use(rehypeSanitize).runSync(tree);
    visitElements(safe, node => {
      const start = node.position?.start.offset;
      const formula = start === undefined ? undefined : formulas.get(start);
      if (!formula || node.position?.end.offset !== formula.end || node.tagName !== (formula.display ? 'div' : 'span')) return;
      const math: HastRoot = { type: 'root', children: [{
        type: 'element', tagName: 'code', properties: { className: [formula.display ? 'math-display' : 'math-inline'] },
        children: [{ type: 'text', value: formula.value }],
      }] };
      // Never run KaTeX over author-provided math classes or fenced `math` code.
      unified().use(rehypeKatex, { trust: false, strict: 'error', maxSize: 20, maxExpand: 1000 }).runSync(math);
      node.properties = { className: ['concord-math', formula.display ? 'concord-math--display' : 'concord-math--inline'] };
      node.children = math.children.filter(child => child.type !== 'doctype');
    });
    return safe;
  };
}
