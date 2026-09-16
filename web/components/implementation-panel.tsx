import { Clipboard, FileCode2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentRecord } from '../../src/shared';
import { useWorkspace } from '../workspace';
import { useDraftNavigation } from './draft-navigation';
import { ActionResult as ResultCard } from './action-result';
import { Field, PageHeader } from './page';
import { ScanNotice } from './repository-tests';
import { SourceDrawer, type SourceLocation } from './source-drawer';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';

function settle(task: Promise<unknown>): void { void task.catch(() => undefined); }

export function ImplementationPanel({ document }: { document: DocumentRecord }) {
  const { snapshot, act } = useWorkspace();
  const [location, setLocation] = useState<SourceLocation | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [annotate, setAnnotate] = useState(false);
  const [id, setId] = useState('');
  const [scope, setScope] = useState<'file' | 'node' | 'region'>('node');
  const [contracts, setContracts] = useState(document.path);
  const sourceNavigation = useDraftNavigation(setLocation);
  const owners = [document, ...(document.metadata.kind === 'feature' ? snapshot.documents.filter(item => item.metadata.kind === 'use-case' && item.metadata.feature.split('#')[0] === document.path) : [])];
  const groups = owners.map(owner => {
    const references = new Set([owner.path, ...snapshot.pages.filter(page => page.documentPath === owner.path).map(page => page.path)]);
    return { owner, codes: snapshot.codes.filter(code => code.contracts.some(ref => references.has(ref.split('#')[0]!))), references };
  });
  const hasImplementations = groups.some(group => group.codes.length > 0);
  const addAssociation = (path: string) => { setContracts(path); setAnnotate(true); };
  const annotation = async (event: React.FormEvent) => {
    event.preventDefault();
    setResult(await act({ action: 'code.annotate', id, scope, contracts: contracts.split('\n').filter(Boolean) }, '代码归属注释已生成。'));
    setAnnotate(false);
  };
  return <>
    <PageHeader title="功能与实现" description="查看当前 Feature 和各个 Use Case 由哪些文件、类或函数实现。" actions={<Button variant="outline" onClick={() => addAssociation(document.path)}><Clipboard />添加实现关联</Button>} />
    <>
      {!hasImplementations && <Card><CardHeader><CardTitle>尚未建立实现关联</CardTitle><CardDescription>配置需要管理的源码目录，再为实现文件或函数添加归属注释。关联后，这里会按功能展示源码位置。</CardDescription></CardHeader><CardContent><div className="button-row"><Button asChild variant="outline"><Link to="/settings">配置源码目录</Link></Button><Button onClick={() => addAssociation(document.path)}>添加实现关联</Button></div></CardContent></Card>}
      <ScanNotice snapshot={snapshot} kind="sources" />
      <div className="record-list mt-4">{groups.map(({ owner, codes, references }) => <section key={owner.path} aria-label={owner.metadata.title + '的实现'}>
        <Card><CardHeader><div className="card-title-row"><div><CardTitle>{owner.metadata.kind === 'feature' ? 'Feature 公共实现' : 'Use Case'} · {owner.metadata.title}</CardTitle><CardDescription>{codes.length} 处实现 · {new Set(codes.map(code => code.file)).size} 个文件</CardDescription></div><Button variant="outline" size="sm" onClick={() => addAssociation(owner.path)}>添加关联</Button></div></CardHeader><CardContent>
          {codes.length === 0 ? <p className="muted">尚未关联实现</p> : <ul className="grid gap-3">{codes.map(code => <li key={code.id} className="min-w-0 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2"><strong>{code.symbol ?? code.file.split('/').at(-1)}</strong><Badge variant="outline">{{ file: '整个文件', node: '类／函数', region: '代码段' }[code.scope]}</Badge></div>
            <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">声明详情</summary><p>声明 ID：<code>{code.id}</code>（供 CLI 查询与关系追踪使用）</p></details>
            <Button className="h-auto max-w-full whitespace-normal text-left" variant="link" onClick={() => sourceNavigation.request({ path: code.file, line: code.line, endLine: code.endLine })}><FileCode2 /><span className="min-w-0 break-all">{code.file} · 第 {code.line}–{code.endLine} 行</span></Button>
            <div className="text-sm text-muted-foreground">关联契约：{code.contracts.filter(ref => references.has(ref.split('#')[0]!)).map(ref => <code className="block break-all" key={ref}>{ref}</code>)}</div>
          </li>)}</ul>}
        </CardContent></Card>
      </section>)}</div>
    </>
    <SourceDrawer location={location} editable onClose={() => sourceNavigation.request(null)} />
    {result !== null && <ResultCard title="归属注释" value={result} />}
<Dialog open={annotate} onOpenChange={setAnnotate}><DialogContent><form onSubmit={event => settle(annotation(event))}><DialogHeader><DialogTitle>生成代码归属注释</DialogTitle><DialogDescription>返回可粘贴的注释助手，不直接改写源码。</DialogDescription></DialogHeader><div className="form-grid"><Field label="声明 ID"><Input aria-label="代码声明 ID" value={id} onChange={event => setId(event.target.value)} required /></Field><Field label="Scope"><Select value={scope} onValueChange={value => setScope(value as typeof scope)}><SelectTrigger aria-label="代码声明范围"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="file">File</SelectItem><SelectItem value="node">Node</SelectItem><SelectItem value="region">Region</SelectItem></SelectContent></Select></Field><Field label="契约引用" hint="每行一个"><Textarea aria-label="实现契约引用" value={contracts} onChange={event => setContracts(event.target.value)} required /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAnnotate(false)}>取消</Button><Button type="submit">生成</Button></DialogFooter></form></DialogContent></Dialog>    {sourceNavigation.dialog}
  </>;
}
