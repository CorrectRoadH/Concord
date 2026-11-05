// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#验收
import { useEffect, useId, useState, type ReactNode } from 'react';

export function MermaidDiagram({ code, children }: { readonly code: string; readonly children: ReactNode }) {
  const id = useId().replaceAll(':', '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void import('pele/lazy').then(async ({ renderAsync, PeleError }) => {
      try {
        const rendered = await renderAsync(code, { idPrefix: `concord-mermaid-${id}`, links: false, images: false });
        if (!cancelled) { setSvg(rendered.svg); setError(''); }
      } catch (cause) {
        if (cancelled) return;
        setSvg('');
        const line = cause instanceof PeleError && cause.line > 0 ? `第 ${cause.line} 行：` : '';
        setError(`${line}${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }).catch(cause => {
      if (!cancelled) { setSvg(''); setError(cause instanceof Error ? cause.message : String(cause)); }
    });
    return () => { cancelled = true; };
  }, [code, id]);

  return <div data-testid="mermaid-editor" className="mermaid-diagram">
    <div aria-label="Mermaid 图表预览" className="mermaid-preview">
      {svg ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : error ? <pre role="alert" className="mermaid-error">{error}</pre> : <span role="status">正在渲染图表…</span>}
    </div>
    <details className="mermaid-source">
      <summary>编辑 Mermaid 源码</summary>
      {children}
    </details>
  </div>;
}
