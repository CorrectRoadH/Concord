// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WorkspaceDocument } from '../../src/model/index';
import { effectiveWorkspaceConcepts, conceptBody } from '../lib/workspace-display';
import { useWorkspace } from '../workspace';
import { Button } from './ui/button';
import { PanelEmpty, PanelHeader, RecordList, RecordItem } from './content-layout';
import { MarkdownPreview } from './markdown-preview';

export function TerminologyPanel({ document }: { readonly document: WorkspaceDocument }) {
  const { api, snapshot } = useWorkspace();
  const concepts = effectiveWorkspaceConcepts(snapshot, document.path);
  const [reference, select] = useState<string | null>(null);
  const selected = concepts.find(item => item.reference === reference);
  const [detail, setDetail] = useState<{ reference: string; digest: string; body?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!selected?.digest) return;
    const controller = new AbortController(), { path, digest, id, reference } = selected;
    void api.file(path, controller.signal).then(file => {
      if (controller.signal.aborted) return;
      setDetail({ reference, digest, ...(file.digest === digest ? { body: conceptBody(file.body, id) } : {}) });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setDetail({ reference, digest, error: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => controller.abort();
  }, [api, selected?.reference, selected?.digest]);
  const current = selected && detail?.reference === selected.reference && detail.digest === selected.digest ? detail : null;
  return <>
    <PanelHeader title="术语" actions={<Button asChild variant="outline" size="sm"><Link to="/terms">打开术语</Link></Button>} />
    {concepts.length === 0 ? <PanelEmpty title="当前代次没有此范围的有效术语">在术语页面管理当前范围或上级范围的术语。</PanelEmpty>
      : <RecordList>{concepts.map(item => <RecordItem key={item.reference}>
        <Button variant="link" className="px-0" onClick={() => select(item.reference)}>{item.term}</Button>
        <code className="block text-xs text-muted-foreground">{item.reference}</code>
        {item.deprecated.length > 0 && <p>弃用名称：{item.deprecated.join('、')} → {item.term}</p>}
        {selected?.reference === item.reference && (current?.error ? <div role="alert" className="form-error">{current.error}</div>
          : current?.body === undefined ? <p role="status">概念正文正在更新…</p> : <MarkdownPreview markdown={current.body} documentPath={item.path} />)}
      </RecordItem>)}</RecordList>}
  </>;
}
