import { Clipboard, FileCode2 } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentRecord } from '../../src/shared';
import { useWorkspace } from '../workspace';
import { useSourceNavigation } from '../hooks/use-url-navigation';
import { ActionResult as ResultCard } from './action-result';
import { Field } from './page';
import { ContentSection, PanelEmpty, PanelHeader, RecordItem, RecordList } from './content-layout';
import { ScanNotice } from './repository-tests';
const SourceDrawer = lazy(() => import('./source-drawer').then(module => ({ default: module.SourceDrawer })));
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

function settle(task: Promise<unknown>): void { void task.catch(() => undefined); }

export function ImplementationPanel({ document }: { document: DocumentRecord }) {
  const { snapshot, act } = useWorkspace();
  const sourceNavigation = useSourceNavigation();
  const [result, setResult] = useState<unknown>(null);
  const [annotate, setAnnotate] = useState(false);
  const [scope, setScope] = useState<'file' | 'node' | 'region'>('node');
  const [contracts, setContracts] = useState(document.path);
  const owners = [document, ...(document.metadata.kind === 'feature' ? snapshot.documents.filter(item => item.metadata.kind === 'use-case' && item.metadata.feature.split('#')[0] === document.path) : [])];
  const references = owners.flatMap(owner => [owner.path, ...snapshot.pages.filter(page => page.documentPath === owner.path).map(page => page.path)]);
  const groups = owners.map(owner => {
    const references = new Set([owner.path, ...snapshot.pages.filter(page => page.documentPath === owner.path).map(page => page.path)]);
    return { owner, codes: snapshot.codes.filter(code => code.contracts.some(ref => references.has(ref.split('#')[0]!))), references };
  });
  const hasImplementations = groups.some(group => group.codes.length > 0);
  const addAssociation = (path: string) => { setContracts(path); setAnnotate(true); };
  const annotation = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(await act({ action: 'code.annotate', scope, contracts: contracts.split('\n').filter(Boolean) }, '关联注释片段已生成。'));
    setAnnotate(false);
  };
  return <>
    <PanelHeader title="实现" actions={<Button variant="outline" onClick={() => addAssociation(document.path)}><Clipboard />添加关联</Button>} />
    <>
      {!hasImplementations && <PanelEmpty title="尚未建立实现关联">配置源码目录并添加归属注释。<Link className="underline" to="/settings">配置源码目录</Link></PanelEmpty>}
      <ScanNotice snapshot={snapshot} kind="sources" />
      <div>{groups.map(({ owner, codes, references }) => <ContentSection key={owner.path} className="implementation-section" aria-label={owner.metadata.title + '的实现'} title={owner !== document && owner.metadata.kind === 'use-case' ? <Link className="hover:underline" to={`/features/${encodeURIComponent(document.metadata.id)}/use-cases/${encodeURIComponent(owner.metadata.id)}`}>{owner.metadata.title}</Link> : owner.metadata.title} summary={<>{codes.length} 处实现 · {new Set(codes.map(code => code.file)).size} 个文件</>}>
          {codes.length === 0 ? <p className="muted">尚未关联实现</p> : <RecordList>{codes.map(code => <RecordItem key={code.id}>
            <div className="implementation-record">
              <div className="implementation-record__source">
                <div className="flex flex-wrap items-center gap-2"><strong>{code.symbol ?? code.file.split('/').at(-1)}</strong><Badge variant="outline">{{ file: '整个文件', node: '类／函数', region: '代码段' }[code.scope]}</Badge></div>
                <Button className="h-auto max-w-full whitespace-normal text-left px-0" variant="link" onClick={() => sourceNavigation.open({ path: code.file, line: code.line, endLine: code.endLine })}><FileCode2 /><span className="min-w-0 break-all">{code.file} · 第 {code.line}–{code.endLine} 行</span></Button>
              </div>
              <div className="implementation-record__relations">
                <div className="text-sm text-muted-foreground">关联契约：{code.contracts.filter(ref => references.has(ref.split('#')[0]!)).map(ref => <code className="block break-all" key={ref}>{ref}</code>)}</div>
              </div>
            </div>
          </RecordItem>)}</RecordList>}
      </ContentSection>)}</div>
    </>
    {sourceNavigation.location && <Suspense fallback={null}><SourceDrawer location={sourceNavigation.location} editable onClose={sourceNavigation.close} /></Suspense>}
    {result !== null && <ResultCard title="归属注释" value={result} />}
<Dialog open={annotate} onOpenChange={setAnnotate}><DialogContent><form onSubmit={event => settle(annotation(event))}><DialogHeader><DialogTitle>生成代码归属注释</DialogTitle><DialogDescription>返回可粘贴的关联注释片段，不直接改写源码。</DialogDescription></DialogHeader><div className="form-grid"><Field label="关联目标"><Select value={references.includes(contracts) ? contracts : ''} onValueChange={setContracts}><SelectTrigger aria-label="实现关联目标"><SelectValue placeholder="自定义契约引用" /></SelectTrigger><SelectContent>{owners.map(owner => <SelectItem key={owner.path} value={owner.path}>{owner.metadata.title}</SelectItem>)}{snapshot.pages.filter(page => page.documentPath && owners.some(owner => owner.path === page.documentPath)).map(page => <SelectItem key={page.path} value={page.path}>{page.path}</SelectItem>)}</SelectContent></Select></Field><Field label="Scope"><Select value={scope} onValueChange={value => setScope(value as typeof scope)}><SelectTrigger aria-label="代码声明范围"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="file">File</SelectItem><SelectItem value="node">Node</SelectItem><SelectItem value="region">Region</SelectItem></SelectContent></Select></Field><Field label="契约引用" hint="每行一个；支持 supporting page 与 #anchor"><Textarea aria-label="实现契约引用" value={contracts} onChange={event => setContracts(event.target.value)} required /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAnnotate(false)}>取消</Button><Button type="submit">生成</Button></DialogFooter></form></DialogContent></Dialog>
  </>;
}
