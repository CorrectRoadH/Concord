import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { RecordDetails } from './content-layout';

/** Read-only rendering never round-trips source bytes through an editor. */
export function MarkdownPreview({ markdown, onFollowLink }: { markdown: string; onFollowLink?: (href: string) => boolean }) {
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
      <Markdown remarkPlugins={[remarkGfm, remarkFrontmatter]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{
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
