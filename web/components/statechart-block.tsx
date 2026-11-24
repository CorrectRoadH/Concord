// @concord-file
// @concord-implements docs/feature/web-workbench/ui.md#markdown-呈现
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StatechartResolution } from '../../src/model/index.ts';
import { useWorkspace } from '../workspace.tsx';
import { MermaidDiagram } from './mermaid-diagram.tsx';
import { Button } from './ui/button.tsx';
import { Textarea } from './ui/textarea.tsx';

const SourceDrawer = lazy(() => import('./source-drawer.tsx').then(module => ({ default: module.SourceDrawer })));

function StatechartPreview({ result, onOpenSource, renderReport }: {
  readonly result: StatechartResolution;
  readonly onOpenSource: (path: string) => void;
  readonly renderReport: (text: string, path: string) => ReactNode;
}) {
  if ('error' in result) return <p role="alert" className="statechart-warning">{result.error.code}：{result.error.message}</p>;
  const { spec, config, out, stale, chart, report } = result;
  return <>
    <div className="statechart-paths">
      <Button variant="link" type="button" onClick={() => onOpenSource(spec)}>模型 <code>{spec}</code></Button>
      <span aria-hidden="true">·</span>
      <Button variant="link" type="button" onClick={() => onOpenSource(config)}>配置 <code>{config}</code></Button>
    </div>
    {stale && <p className="statechart-warning">模型在这份结果之后改过，状态图已过期</p>}
    {chart && ('error' in chart ? <p role="alert" className="statechart-warning">{chart.error}</p>
      : <div className="statechart-chart"><MermaidDiagram code={chart.text} /></div>)}
    {'error' in report ? <p role="alert" className="statechart-warning">{report.error}</p> : <details className="statechart-report" open>
      <summary>检查报告</summary>
      {renderReport(report.text, `${out}/report.md`)}
    </details>}
  </>;
}

interface StatechartBlockProps {
  readonly document: string;
  readonly code: string;
  readonly meta: string;
  readonly source: string;
  readonly onEdit?: (value: string) => void;
  readonly readOnly: boolean;
  readonly renderReport: (text: string, path: string) => ReactNode;
}

export function StatechartBlock({ document, code, meta, source, onEdit, readOnly, renderReport }: StatechartBlockProps) {
  const { api, projection } = useWorkspace();
  const [response, setResponse] = useState<{ key: string; value: StatechartResolution | string }>();
  const [sourcePath, setSourcePath] = useState<string>();
  const sourceDetails = useRef<HTMLDetailsElement>(null);
  const key = JSON.stringify([document, code, meta]);
  useEffect(() => {
    const controller = new AbortController();
    void api.statechart({ document, code, meta }, controller.signal).then(value => {
      if (!controller.signal.aborted) setResponse({ key, value });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setResponse({ key, value: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => controller.abort();
  }, [api, document, code, meta, key, projection.sourceDigest]);

  const result = response?.key === key ? response.value : undefined;
  const failed = typeof result === 'string' || (result !== undefined && ('error' in result || 'error' in result.report || (result.chart !== undefined && 'error' in result.chart)));
  useEffect(() => {
    if (failed && sourceDetails.current) sourceDetails.current.open = true;
  }, [failed]);
  return <section className="statechart-block">
    {result === undefined ? <p role="status">正在渲染图表…</p>
      : typeof result === 'string' ? <p role="alert" className="statechart-warning">{result}</p>
      : <StatechartPreview result={result} onOpenSource={setSourcePath} renderReport={renderReport} />}
    <details className="statechart-source" ref={sourceDetails}>
      <summary>{onEdit ? '编辑状态图块源码' : '查看状态图块源码'}</summary>
      {onEdit ? <Textarea aria-label="状态图块源码" value={source} onChange={event => onEdit(event.target.value)} readOnly={readOnly} wrap="off" rows={3} />
        : <pre><code>{source}</code></pre>}
    </details>
    {sourcePath && <Suspense fallback={<span role="status">正在读取源码…</span>}>
      <SourceDrawer key={sourcePath} location={{ path: sourcePath }} onClose={() => setSourcePath(undefined)} />
    </Suspense>}
  </section>;
}
