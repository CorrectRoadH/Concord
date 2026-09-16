// @concord-file web-workbench-operations
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { Activity, AlertTriangle, Braces, CheckCircle2, Clipboard, Code2, Database, Play, RefreshCw, Square, Stethoscope, Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { DocumentRecord } from '../../src/shared';
import type { ViewAction } from '../../src/view-contract';
import { ActionResult as ResultCard } from '../components/action-result';
export { ImplementationPanel } from '../components/implementation-panel';
import { Definition, Empty, Field, PageHeader } from '../components/page';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { SourceDrawer, type SourceLocation } from '../components/source-drawer';
import { dateTime, humanKind } from '../lib/utils';
import { useWorkspace } from '../workspace';
import { relatedRepositoryTests, RepositoryTestCards, ScanNotice, scanFindings } from '../components/repository-tests';

function settle(task: Promise<unknown>): void { void task.catch(() => undefined); }

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('当前浏览器不允许复制到剪贴板');
  } finally {
    textarea.remove();
  }
}

export function OverviewPage() {
  const { snapshot, jobs, git, notify } = useWorkspace(); const docs = snapshot.documents;
  const counts = { feature: docs.filter(x => x.metadata.kind === 'feature').length, cases: snapshot.cases.length + (snapshot.repositoryTests?.tests.length ?? 0), code: snapshot.codes.length, findings: snapshot.findings.length };
  const running = jobs.find(job => ['queued', 'running', 'cancelling'].includes(job.state));
  const floating = docs.filter(document => {
    if (!['feature', 'use-case', 'engineering'].includes(document.metadata.kind)) return false;
    const identities = new Set([document.path, ...snapshot.pages.filter(page => page.documentPath === document.path).map(page => page.path)]);
    const hasCode = snapshot.codes.some(code => code.contracts.some(contract => identities.has(contract.split('#')[0]!)));
    const hasTest = snapshot.cases.some(testCase => identities.has(testCase.contract.split('#')[0]!))
      || relatedRepositoryTests(snapshot, document).length > 0;
    return !hasCode && !hasTest;
  });
  const copyFloating = async () => {
    try {
      const text = floating.map(document => `- [${humanKind(document.metadata.kind)}] ${document.metadata.title} — ${document.path}`).join('\n');
      await copyText(text);
      notify(`已复制 ${floating.length} 项悬空功能。`, 'success');
    } catch (cause) {
      notify(`复制失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
    }
  };
  return <><PageHeader eyebrow="Concord workspace" title={snapshot.project ? snapshot.root.split('/').filter(Boolean).at(-1) ?? '项目工作区' : '尚未初始化的项目'} description={snapshot.root} /><div className="metric-grid"><Metric label="Feature" value={counts.feature} icon={<Braces />} href="/features" /><Metric label="测试声明" value={counts.cases} icon={<CheckCircle2 />} href="/features" /><Metric label="实现声明" value={counts.code} icon={<Code2 />} href="/features" /><Metric label="Git 变更" value={git?.entries.filter(entry => entry.path.startsWith('docs/') || entry.previousPath?.startsWith('docs/')).length ?? 0} icon={<Activity />} href="/git" /></div><div className="dashboard-grid"><Card><CardHeader><CardTitle>工作区健康</CardTitle><CardDescription>来自当前严格扫描的诊断，不代表测试覆盖率。</CardDescription></CardHeader><CardContent>{snapshot.findings.length === 0 ? <div className="healthy"><CheckCircle2 />没有发现结构问题</div> : <div className="finding-list">{snapshot.findings.slice(0, 8).map((finding, index) => <div key={`${finding.path}-${index}`}><AlertTriangle /><div><strong>{finding.code}</strong><span>{finding.path}{finding.line ? `:${finding.line}` : ''}</span><p>{finding.message}</p></div></div>)}</div>}</CardContent></Card><Card><CardHeader><CardTitle>执行状态</CardTitle><CardDescription>浏览器离开不会取消服务端任务。</CardDescription></CardHeader><CardContent>{running ? <div className="job-highlight"><Badge>{running.state}</Badge><strong>{running.caseId}</strong><span>{dateTime(running.startedAt)}</span></div> : <p className="muted">当前没有运行中的测试任务。</p>}<Button asChild variant="outline"><Link to="/features">从 Feature 查看测试与任务</Link></Button></CardContent></Card></div><Card className="floating-card"><CardHeader><div className="card-title-row"><div><CardTitle>悬空功能</CardTitle><CardDescription>同时没有实现声明和测试声明的 Feature、Use Case 与 Engineering。</CardDescription></div><div className="inline-badges"><Badge variant="secondary">{floating.length}</Badge><Button size="sm" variant="outline" disabled={floating.length === 0} onClick={() => settle(copyFloating())}><Clipboard />复制全部</Button></div></div></CardHeader><CardContent>{floating.length === 0 ? <div className="healthy"><CheckCircle2 />没有悬空功能</div> : <div className="floating-list">{floating.map(document => <Link key={document.path} to={overviewDocumentHref(document)}><div><strong>{document.metadata.title}</strong><span>{document.path}</span></div><div className="inline-badges"><Badge variant="outline">{humanKind(document.metadata.kind)}</Badge><Badge variant="secondary">缺少实现</Badge><Badge variant="secondary">缺少测试</Badge></div></Link>)}</div>}</CardContent></Card><Card><CardHeader><CardTitle>契约结构</CardTitle></CardHeader><CardContent><div className="kind-strip">{['feature', 'use-case', 'engineering', 'roadmap', 'design', 'research', 'memory', 'issue'].map(kind => <div key={kind}><strong>{docs.filter(doc => doc.metadata.kind === kind).length}</strong><span>{kind}</span></div>)}</div></CardContent></Card></>;
}

function overviewDocumentHref(document: DocumentRecord): string {
  if (document.metadata.kind === 'use-case') {
    const feature = document.metadata.feature.split('/').filter(Boolean).at(-2) ?? document.metadata.feature;
    return `/features/${encodeURIComponent(feature)}/use-cases/${encodeURIComponent(document.metadata.id)}`;
  }
  return `/${document.metadata.kind === 'feature' ? 'features' : 'engineering'}/${encodeURIComponent(document.metadata.id)}`;
}
function Metric({ label, value, icon, href }: { label: string; value: number; icon: React.ReactNode; href: string }) { return <Link to={href} className="metric"><div>{icon}</div><strong>{value}</strong><span>{label}</span></Link>; }

export function contractIdentities(snapshot: ReturnType<typeof useWorkspace>['snapshot'], document: DocumentRecord): Set<string> {
  const owners = new Set([document.path]);
  if (document.metadata.kind === 'feature') {
    for (const child of snapshot.documents) if (child.metadata.kind === 'use-case' && child.metadata.feature === document.path) owners.add(child.path);
  }
  return new Set([...owners, ...snapshot.pages.filter(page => page.documentPath && owners.has(page.documentPath)).map(page => page.path)]);
}

export function TestingPanel({ document }: { document: DocumentRecord }) {
  const { snapshot, jobs, runCase, cancelJob, busy, act } = useWorkspace(); const [query, setQuery] = useState(''); const [result, setResult] = useState<unknown>(null); const [sourceLocation, setSourceLocation] = useState<SourceLocation | null>(null); const [annotate, setAnnotate] = useState(false); const [contract, setContract] = useState(document.path); const [regressions, setRegressions] = useState('');
  const identities = contractIdentities(snapshot, document);
  const relatedCases = snapshot.cases.filter(item => identities.has(item.contract.split('#')[0]!));
  const profileCases = relatedRepositoryTests(snapshot, document).filter(item => `${item.id} ${item.name} ${item.file}`.toLowerCase().includes(query.toLowerCase()));
  const cases = relatedCases.filter(item => `${item.id} ${item.name} ${item.file}`.toLowerCase().includes(query.toLowerCase()));
  const annotation = async (event: React.FormEvent) => { event.preventDefault(); const value = await act({ action: 'test.annotate', contract, regressions: regressions.split('\n').filter(Boolean) }, '测试注释片段已生成。'); setResult(value); setAnnotate(false); };
  return <><PageHeader eyebrow="Executable declarations" title="测试" description="运行项目声明的命令验收单元；结果不会被描述为原生 case 覆盖证明。" actions={<Button variant="outline" onClick={() => setAnnotate(true)}><Clipboard />生成注释</Button>} /><SourceDrawer location={sourceLocation} onClose={() => setSourceLocation(null)} /><Tabs defaultValue="cases"><TabsList><TabsTrigger value="cases">测试声明</TabsTrigger><TabsTrigger value="jobs">运行任务 <Badge variant="secondary">{jobs.filter(job => relatedCases.some(item => item.id === job.caseId)).length}</Badge></TabsTrigger></TabsList><TabsContent value="cases"><div className="list-toolbar"><Input aria-label="筛选测试" placeholder="测试名称或文件…" value={query} onChange={event => setQuery(event.target.value)} /><Badge variant="secondary">{cases.length + profileCases.length} 项</Badge></div><ScanNotice snapshot={snapshot} kind="tests" /><div className="record-list"><RepositoryTestCards snapshot={snapshot} document={document} query={query} onOpenSource={path => setSourceLocation({ path, line: 1, endLine: 1 })} />{cases.map(item => { const active = jobs.find(job => job.caseId === item.id && ['queued', 'running', 'cancelling'].includes(job.state)); return <Card key={item.id}><CardHeader><div className="card-title-row"><div><CardTitle>{item.name}</CardTitle><CardDescription>{item.file}:{item.line}</CardDescription></div><div className="inline-badges"><Badge variant={item.status === 'active' ? 'default' : 'secondary'}>{item.status}</Badge>{item.skipped && <Badge variant="outline">skipped</Badge>}</div></div></CardHeader><CardContent><Button variant="outline" onClick={() => setSourceLocation({ path: item.file, line: item.line, endLine: item.line })}>查看测试源码</Button><dl><Definition label="契约"><code>{item.contract}</code></Definition><Definition label="框架">{item.framework}</Definition>{item.regressions.length > 0 && <Definition label="Regression">{item.regressions.map(ref => <code key={ref}>{ref}</code>)}</Definition>}</dl>{active ? <Button variant="destructive" onClick={() => void cancelJob(active.id)}><Square />{active.state === 'cancelling' ? '正在终止…' : '安全终止'}</Button> : <Button disabled={busy || item.status !== 'active' || item.skipped} onClick={() => void runCase(item.id)}><Play />运行声明命令</Button>}</CardContent></Card>; })}{cases.length + profileCases.length === 0 && snapshot.repositoryTests?.status !== 'failed' && scanFindings(snapshot, 'tests').length === 0 && ((snapshot.project?.testRoots.length ?? 0) > 0 || snapshot.repositoryTests?.status === 'ready') && <Empty title={query ? "没有匹配的测试" : "未发现当前契约的关联测试"} />}</div></TabsContent><TabsContent value="jobs"><JobList caseIds={new Set(relatedCases.map(item => item.id))} /></TabsContent></Tabs>{result !== null && <ResultCard title="生成结果" value={result} />}<Dialog open={annotate} onOpenChange={setAnnotate}><DialogContent><form onSubmit={event => settle(annotation(event))}><DialogHeader><DialogTitle>生成测试注释</DialogTitle><DialogDescription>生成供你粘贴到源码的注释片段，不会修改测试文件。</DialogDescription></DialogHeader><div className="form-grid"><Field label="Feature / Use Case 引用"><Input aria-label="测试契约引用" value={contract} onChange={event => setContract(event.target.value)} required list="contract-references" /></Field><Field label="Regression Problem" hint="每行一个引用"><Textarea aria-label="Regression 引用" value={regressions} onChange={event => setRegressions(event.target.value)} /></Field><datalist id="contract-references">{snapshot.documents.filter(doc => ['feature', 'use-case'].includes(doc.metadata.kind)).map(doc => <option key={doc.path} value={doc.path} />)}</datalist></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAnnotate(false)}>取消</Button><Button type="submit">生成</Button></DialogFooter></form></DialogContent></Dialog></>;
}

function JobList({ caseIds }: { caseIds: ReadonlySet<string> }) { const { jobs: allJobs, cancelJob } = useWorkspace(); const jobs = allJobs.filter(job => caseIds.has(job.caseId)); if (jobs.length === 0) return <Empty title="尚无测试任务" />; return <div className="record-list">{jobs.map(job => <Card key={job.id}><CardHeader><div className="card-title-row"><CardTitle>{job.caseId}</CardTitle><Badge variant={job.state === 'completed' ? 'default' : job.state === 'failed' || job.state === 'cleanup-failed' ? 'destructive' : 'secondary'}>{job.state}</Badge></div><CardDescription>{job.id}</CardDescription></CardHeader><CardContent><dl><Definition label="开始">{dateTime(job.startedAt)}</Definition><Definition label="结束">{dateTime(job.finishedAt)}</Definition>{job.error && <Definition label="错误">{job.error.code}: {job.error.message}</Definition>}{job.evidence && <Definition label="证据"><code>{job.evidence.id}</code></Definition>}</dl>{['queued', 'running', 'cancelling'].includes(job.state) && <Button variant="destructive" disabled={job.state === 'cancelling'} onClick={() => void cancelJob(job.id)}><Square />终止</Button>}</CardContent></Card>)}</div>; }


export function EvidencePage() { const { snapshot, act } = useWorkspace(); const [result, setResult] = useState<unknown>(null); return <><PageHeader eyebrow="Private receipts" title="证据" description="证据是本工作树内的私有命令收据；历史可读不等于当前验证。" /><div className="record-list">{snapshot.evidenceIds.map(id => <Card key={id}><CardHeader><CardTitle><code>{id}</code></CardTitle></CardHeader><CardContent><Button variant="outline" onClick={() => settle(act({ action: 'evidence.show', id }, '证据已读取。').then(setResult))}>查看收据</Button></CardContent></Card>)}{snapshot.evidenceIds.length === 0 && <Empty title="尚无证据" />}</div>{result !== null && <ResultCard title="证据收据" value={result} />}</>; }

const tools: readonly { title: string; description: string; action: ViewAction; icon: React.ReactNode }[] = [
  { title: '完整检查', description: '验证项目文档、关系与声明。', action: { action: 'check' }, icon: <CheckCircle2 /> },
  { title: 'Trace 检查', description: '检查派生关系图。', action: { action: 'trace.check' }, icon: <Activity /> },
  { title: 'Doctor', description: '给出配置和接入诊断，不运行测试。', action: { action: 'doctor' }, icon: <Stethoscope /> },
  { title: '恢复中断写入', description: '按 journal 规则恢复，不覆盖未知编辑。', action: { action: 'recover' }, icon: <Wrench /> },
  { title: 'Cache 状态', description: '查看可重建 SQLite 缓存。', action: { action: 'cache.status' }, icon: <Database /> },
  { title: '重建 Cache', description: '从源事实重新构建缓存。', action: { action: 'cache.rebuild' }, icon: <RefreshCw /> },
  { title: '清理 Cache', description: '清除可重建缓存，不删除证据或文档。', action: { action: 'cache.clear' }, icon: <Database /> },
];

export function ToolsPage() { const { snapshot, act } = useWorkspace(); const [result, setResult] = useState<unknown>(null); const [reference, setReference] = useState(''); const [template, setTemplate] = useState(snapshot.templates[0]?.name ?? ''); const [title, setTitle] = useState(''); const invoke = (action: ViewAction) => settle(act(action).then(setResult)); return <><PageHeader eyebrow="Operations" title="诊断与工具" description="在一个页面运行检查、诊断、审阅与模板工具。" /><div className="card-grid">{tools.map(tool => <Card key={tool.title}><CardHeader><div className="tool-icon">{tool.icon}</div><CardTitle>{tool.title}</CardTitle><CardDescription>{tool.description}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => invoke(tool.action)}>运行</Button></CardContent></Card>)}</div><div className="dashboard-grid"><Card><CardHeader><CardTitle>定向 Trace / Review</CardTitle></CardHeader><CardContent><div className="form-grid"><Field label="引用（Review 可留空）"><Input aria-label="定向引用" value={reference} onChange={event => setReference(event.target.value)} /></Field><div className="button-row"><Button variant="outline" disabled={!reference} onClick={() => invoke({ action: 'trace.show', reference })}>查看 Trace</Button><Button variant="outline" onClick={() => invoke({ action: 'review.render', ...(reference ? { reference } : {}) })}>渲染 Review</Button></div></div></CardContent></Card><Card><CardHeader><CardTitle>模板</CardTitle></CardHeader><CardContent><div className="form-grid"><Field label="模板"><Select value={template} onValueChange={setTemplate}><SelectTrigger aria-label="模板"><SelectValue placeholder="选择模板" /></SelectTrigger><SelectContent>{snapshot.templates.map(item => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="标题（可选）"><Input aria-label="模板标题" value={title} onChange={event => setTitle(event.target.value)} /></Field><Button variant="outline" disabled={!template} onClick={() => invoke({ action: 'template.show', name: template, ...(title ? { title } : {}) })}>查看模板</Button></div></CardContent></Card></div>{result !== null && <ResultCard title="运行结果" value={result} />}</>; }
