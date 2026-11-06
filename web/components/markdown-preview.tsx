import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, RootContent } from 'mdast';
import { P5Sketch } from './p5-sketch.tsx';
import { MermaidDiagram } from './mermaid-diagram.tsx';
import { RecordDetails } from './content-layout.tsx';
import { rehypeSafeMath, remarkMathNodes } from './markdown-math.ts';

/** Read-only rendering never round-trips source bytes through an editor. */
function diagramBlocks(markdown: string): ReadonlyMap<number, { language: string; code: string; meta: string }> {
  const blocks = new Map<number, { language: string; code: string; meta: string }>();
  const visit = (node: Root | RootContent): void => {
    if (node.type === 'code' && (node.lang === 'p5' || node.lang?.toLowerCase() === 'mermaid') && node.position?.start.offset !== undefined) {
      blocks.set(node.position.start.offset, { language: node.lang.toLowerCase(), code: node.value, meta: node.meta ?? '' });
    }
    if ('children' in node) for (const child of node.children) visit(child);
  };
  visit(fromMarkdown(markdown));
  return blocks;
}

export function MarkdownPreview({ markdown, documentPath, onFollowLink }: { markdown: string; documentPath?: string; onFollowLink?: (href: string) => boolean }) {
  const diagrams = useMemo(() => diagramBlocks(markdown), [markdown]);
  const renderPre = useMemo<Components['pre']>(() => ({ children, ...props }) => {
    const offset = props.node?.position?.start.offset;
    const diagram = offset === undefined ? undefined : diagrams.get(offset);
    if (diagram?.language === 'p5') return <P5Sketch code={diagram.code} meta={diagram.meta} document={documentPath} />;
    if (diagram?.language === 'mermaid') return <MermaidDiagram code={diagram.code}><pre><code>{diagram.code}</code></pre></MermaidDiagram>;
    const { node: _node, ...attributes } = props;
    return <pre {...attributes}>{children}</pre>;
  }, [diagrams, documentPath]);
  const article = useRef<HTMLElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { hash } = location;
  useEffect(() => {
    if (!hash) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    // Keep rehype-sanitize's DOM-clobbering protection and map source anchors to it.
    const target = article.current?.querySelector(`[id="${CSS.escape(`user-content-${id}`)}"]`);
    target?.scrollIntoView();
  }, [hash, markdown]);
  return <>
    <article ref={article} className="wysiwyg__content min-h-0" data-testid="markdown-preview">
      <Markdown remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath, remarkMathNodes]} rehypePlugins={[rehypeSafeMath]} components={{
        pre: renderPre,
        a: ({ node: _node, href, children, ...props }) => <a {...props} href={href} onClick={event => {
          if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (href.startsWith('#')) {
            event.preventDefault();
            let id: string;
            try { id = decodeURIComponent(href.slice(1)); } catch { return; }
            const target = article.current?.querySelector(`[id="${CSS.escape(`user-content-${id}`)}"]`);
            target?.scrollIntoView();
            navigate({ pathname: location.pathname, search: location.search, hash: href });
          } else if (onFollowLink?.(href)) event.preventDefault();
        }}>{children}</a>,
      }}>{markdown}</Markdown>
    </article>
    <RecordDetails title="查看原文与元数据"><pre>{markdown}</pre></RecordDetails>
  </>;
}
