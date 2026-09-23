// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentRecord } from '../../src/shared';
import type { showConcepts } from '../../src/concepts';
import { useWorkspace } from '../workspace';
import { Button } from './ui/button';
import { PanelEmpty, PanelHeader, RecordList, RecordItem } from './content-layout';

type ConceptShow = ReturnType<typeof showConcepts>;

function catalogPath(documentPath: string): string {
  return `${documentPath.slice(0, documentPath.lastIndexOf('/'))}/concepts.json`;
}

export function TerminologyPanel({ document }: { readonly document: DocumentRecord }) {
  const { api } = useWorkspace();
  const path = catalogPath(document.path);
  const currentPath = useRef(path);
  currentPath.current = path;
  const generation = useRef(0);
  const [response, setResponse] = useState<{ readonly path: string; readonly value: ConceptShow } | null>(null);
  const [error, setError] = useState<{ readonly path: string; readonly message: string } | null>(null);
  useEffect(() => {
    const ticket = ++generation.current;
    setResponse(null);
    setError(null);
    void api.action({ action: 'concepts.show', path }).then(value => {
      const result = value as ConceptShow;
      if (generation.current === ticket && currentPath.current === path && result.path === path) setResponse({ path, value: result });
    }).catch((cause: unknown) => {
      if (generation.current === ticket && currentPath.current === path) setError({ path, message: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { generation.current++; };
  }, [api, path]);

  const current = response?.path === path ? response.value : null;
  const currentError = error?.path === path ? error.message : '';
  return <>
    <PanelHeader title="术语" actions={<Button asChild variant="outline" size="sm"><Link to="/terms">打开术语</Link></Button>} />
    <p className="path-text">术语表：<code>{path}</code>；包含本范围、上级范围和引用的术语定义。</p>
    {currentError ? <div role="alert" className="form-error">术语目录读取失败：{currentError}</div>
      : !current ? <p role="status">正在读取有效术语…</p>
      : <>
        {current.state === 'invalid' && <div role="alert" className="form-error">本地术语表无效：{current.diagnostic}</div>}
        {current.diagnostics.length > 0 && <div role="alert" className="form-error"><strong>术语诊断</strong><ul>{current.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{item.code}：{item.message}（{item.sources.join('、')}）</li>)}</ul></div>}
        {current.effectiveConcepts.length === 0 ? <PanelEmpty title="此范围暂无有效术语">在术语页面管理当前范围或上级范围的术语。</PanelEmpty>
          : <RecordList>{current.effectiveConcepts.map(item => <RecordItem key={item.reference}>
            <strong>{item.concept.names.zh?.preferred ?? item.concept.names['zh-CN']?.preferred ?? item.concept.names.en?.preferred ?? item.concept.id}</strong>
            {item.concept.names.en && (item.concept.names.zh?.preferred ?? item.concept.names['zh-CN']?.preferred ?? item.concept.names.en.preferred) !== item.concept.names.en.preferred && <span className="ml-2 text-sm text-muted-foreground">{item.concept.names.en.preferred}</span>}
            <p className="mb-0 mt-2">{item.concept.definition}</p>
            <code className="text-xs text-muted-foreground">{item.reference}</code>
            <dl>{Object.entries(item.concept.names).map(([language, name]) => <div key={language} className="mt-2"><dt className="font-medium">{language} · 首选：{name.preferred}</dt><dd className="ml-0 text-sm text-muted-foreground">{name.aliases?.length ? `允许名称：${name.aliases.join('、')}` : '允许名称：无'}；{name.deprecated?.length ? `弃用名称：${name.deprecated.join('、')}` : '弃用名称：无'}</dd></div>)}</dl>
          </RecordItem>)}</RecordList>}
      </>}
  </>;
}
