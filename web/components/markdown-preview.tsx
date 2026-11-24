import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Markdown, { type Components } from 'react-markdown';
import { diagramBlocks, markdownRemarkPlugins, type MarkdownSourceRange } from '../lib/markdown-blocks.ts';
import { P5Sketch } from './p5-sketch.tsx';
import { MermaidDiagram } from './mermaid-diagram.tsx';
import { RecordDetails } from './content-layout.tsx';
import { rehypeSafeMath } from './markdown-math.ts';
import { StatechartBlock } from './statechart-block.tsx';

type FollowLink = (href: string, from?: string) => boolean;

const DiagramContext = createContext<{
  readonly diagrams: ReturnType<typeof diagramBlocks>;
  readonly documentPath?: string;
  readonly embedded: boolean;
  readonly readOnly: boolean;
  readonly onFollowLink?: FollowLink;
  readonly onReplaceBlock?: (range: MarkdownSourceRange, value: string) => void;
}>({ diagrams: new Map(), embedded: false, readOnly: true });

const MarkdownPre: NonNullable<Components['pre']> = ({ children, node, ...props }) => {
  const { diagrams, documentPath, embedded, readOnly, onFollowLink, onReplaceBlock } = useContext(DiagramContext);
  const offset = node?.position?.start.offset;
  const block = offset === undefined ? undefined : diagrams.get(offset);
  if (block?.language === 'p5') return <P5Sketch code={block.code} meta={block.meta} document={documentPath} />;
  if (block?.language === 'mermaid') return <MermaidDiagram code={block.code}><pre><code>{block.code}</code></pre></MermaidDiagram>;
  if (block?.language === 'statechart' && documentPath && !embedded) return <StatechartBlock
    document={documentPath} code={block.code} meta={block.meta} source={block.source} readOnly={readOnly}
    onEdit={onReplaceBlock && (value => onReplaceBlock(block, value))}
    renderReport={(text, path) => <MarkdownPreview markdown={text} documentPath={path} onFollowLink={onFollowLink} embedded />}
  />;
  return <pre {...props}>{children}</pre>;
};

export function MarkdownPreview({ markdown, documentPath, onFollowLink, onReplaceBlock, embedded = false, readOnly = true }: {
  readonly markdown: string;
  readonly documentPath?: string;
  readonly onFollowLink?: FollowLink;
  readonly onReplaceBlock?: (range: MarkdownSourceRange, value: string) => void;
  readonly embedded?: boolean;
  readonly readOnly?: boolean;
}) {
  const diagrams = useMemo(() => diagramBlocks(markdown), [markdown]);
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
  return <DiagramContext.Provider value={{ diagrams, documentPath, embedded, readOnly, onFollowLink, onReplaceBlock }}>
    <article ref={article} className="wysiwyg__content min-h-0" data-testid="markdown-preview">
      <Markdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={[rehypeSafeMath]} components={{
        pre: MarkdownPre,
        a: ({ node: _node, href, children, ...props }) => <a {...props} href={href} onClick={event => {
          if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (href.startsWith('#')) {
            event.preventDefault();
            let id: string;
            try { id = decodeURIComponent(href.slice(1)); } catch { return; }
            const target = article.current?.querySelector(`[id="${CSS.escape(`user-content-${id}`)}"]`);
            target?.scrollIntoView();
            navigate({ pathname: location.pathname, search: location.search, hash: href });
          } else if (onFollowLink?.(href, documentPath)) event.preventDefault();
        }}>{children}</a>,
      }}>{markdown}</Markdown>
    </article>
    {!embedded && <RecordDetails title="查看原文与元数据"><pre>{markdown}</pre></RecordDetails>}
  </DiagramContext.Provider>;
}
