// @concord-file workbench-supporting-document-inventory
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../workspace';
import { MarkdownEditor } from '../components/markdown-editor';
import { Empty, PageHeader } from '../components/page';
import { Input } from '../components/ui/input';

export function PagesPage() {
  const { snapshot } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const pages = snapshot.pages.filter(page => page.path.toLowerCase().includes(query.toLowerCase()));
  const selected = snapshot.pages.find(page => page.path === params.get('path'));
  return <><PageHeader title="文档与模板" description="项目内的支持页面、入门文档和模板；损坏的受管文档保留原文供诊断。" />
    <div className="list-toolbar"><Input aria-label="筛选文档路径" placeholder="输入路径筛选…" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <div className="split-pane"><aside className="file-list">{pages.map(page => <button key={page.path} data-active={page.path === selected?.path} onClick={() => setParams({path:page.path})}><span>{page.path.split('/').at(-1)}</span><small>{page.path}{page.readOnly ? ' · 只读' : ''}</small></button>)}</aside>
      <section className="split-pane__main">{selected ? <MarkdownEditor key={selected.path} initial={selected} /> : <Empty title="选择一份文档">支持页面也可以从所属 Feature、Design 或 Engineering 进入。</Empty>}</section>
    </div>
  </>;
}
