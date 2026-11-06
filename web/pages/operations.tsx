import { PathContextMenu } from '../components/path-context-menu.tsx';
import { copyText } from '../lib/clipboard.ts';
import { Activity, AlertTriangle, Braces, CheckCircle2, Clipboard, Code2, Database, Play, RefreshCw, Square, Stethoscope, Wrench } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { documentHref } from '../lib/document-routing.ts';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import type { ViewAction } from '../../src/model/index.ts';
import type { WorkspaceDocument, WorkspaceProjectionSnapshot } from '../../src/model/index.ts';
import { ActionResult as ResultCard } from '../components/action-result.tsx';
export { ImplementationPanel } from '../components/implementation-panel.tsx';
import { Definition, Empty, Field, PageHeader } from '../components/page.tsx';
import { PanelEmpty, PanelHeader, RecordList, RecordItem, RecordLink, RecordDetails } from '../components/content-layout.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog.tsx';
import { Input } from '../components/ui/input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
const SourceDrawer = lazy(() => import('../components/source-drawer.tsx').then(module => ({ default: module.SourceDrawer })));
import { dateTime, humanKind } from '../lib/utils.ts';
import { projectionIsConclusive, useWorkspace } from '../workspace.tsx';
import { ScanNotice, scanFindings } from '../components/scan-notice.tsx';

function settle(task: Promise<unknown>): void { void task.catch(() => undefined); }


// @concord-code
// @concord-implements docs/feature/web-workbench/README.md
export function OverviewPage() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash !== "#workspace-health") return;
    const frame = requestAnimationFrame(() => document.getElementById("workspace-health")?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [location.key, location.hash]);
  const { snapshot, projection, git, notify } = useWorkspace(); const docs = snapshot.documents;
  const conclusive = projectionIsConclusive(projection);
  const counts = { feature: docs.filter(x => x.metadata.kind === 'feature').length, cases: snapshot.cases.length, code: snapshot.codes.length, findings: snapshot.findings.length };
  const healthUnknownReasons = [
    projection.status === 'refresh-failed' ? '最近刷新失败，当前来源状态未知' : null,
    projection.status === 'blocked' ? '刷新被阻断，当前来源状态未知' : null,
    projection.complete === false ? '扫描不完整' : null,
    projection.unknownRelations ? '部分关系未知' : null,
  ].filter((value): value is string => value !== null);
  const floating = conclusive ? docs.filter(document => {
    if (!['feature', 'use-case', 'engineering'].includes(document.metadata.kind)) return false;
    const identities = contractIdentities(snapshot, document);
    const hasCode = snapshot.codes.some(code => code.contracts.some(contract => identities.has(contract.split('#')[0]!)));
    const hasTest = snapshot.cases.some(testCase => identities.has(testCase.contract.split('#')[0]!))
;
    return !hasCode && !hasTest;
  }) : [];
  const copyFloating = async () => {
    try {
      const text = floating.map(document => `- [${humanKind(document.metadata.kind)}] ${document.metadata.title} — ${document.path}`).join('\n');
      await copyText(text);
      notify(`已复制 ${floating.length} 项悬空功能。`, 'success');
    } catch (cause) {
      notify(`复制失败：${cause instanceof Error ? cause.message : String(cause)}`, 'error');
    }
  };
  return <><PageHeader title={snapshot.project ? snapshot.root.split('/').filter(Boolean).at(-1) ?? '项目工作区' : '尚未初始化的项目'} description={snapshot.root} /><div className="metric-grid"><Metric label="Feature" value={counts.feature} icon={<Braces />} href="/features" /><Metric label="测试声明" value={counts.cases} icon={<CheckCircle2 />} href="/features" /><Metric label="实现声明" value={counts.code} icon={<Code2 />} href="/features" /><Metric label="Git 变更" value={git?.entries.length ?? 0} icon={<Activity />} href="/git" /></div><div className="dashboard-grid"><Card id="workspace-health" className="scroll-mt-4"><CardHeader><CardTitle>工作区健康</CardTitle><CardDescription>来自服务端结构投影的诊断；不表示当前来源已核验，也不代表测试覆盖率。</CardDescription></CardHeader><CardContent>{healthUnknownReasons.length > 0 && <div className="callout callout--warning"><AlertTriangle /><div><strong>健康结论未知</strong><p>{healthUnknownReasons.join('；')}{projection.changedPaths.length > 0 ? `。变化路径：${projection.changedPaths.slice(0, 6).join('、')}${projection.changedPaths.length > 6 ? ` 等 ${projection.changedPaths.length} 项` : ''}` : ''}</p></div></div>}{snapshot.findings.length > 0 ? <RecordList aria-label="结构诊断">{snapshot.findings.slice(0, 8).map((finding, index) => <RecordItem key={`${finding.path}-${index}`}><div className="flex items-start gap-2"><AlertTriangle className="shrink-0 text-amber-600" /><div><strong>{finding.code}</strong><span className="block text-sm text-muted-foreground">{finding.path}{finding.line ? `:${finding.line}` : ''}</span><p>{finding.message}</p></div></div></RecordItem>)}</RecordList> : conclusive ? <div className="healthy"><CheckCircle2 />没有发现结构问题</div> : null}</CardContent></Card></div><Card className="floating-card"><CardHeader><div className="card-title-row"><div><CardTitle>悬空功能</CardTitle><CardDescription>同时没有实现声明和测试声明的 Feature、Use Case 与 Engineering。</CardDescription></div><div className="inline-badges"><Badge variant="secondary">{conclusive ? floating.length : '未知'}</Badge><Button size="sm" variant="outline" disabled={!conclusive || floating.length === 0} onClick={() => settle(copyFloating())}><Clipboard />复制全部</Button></div></div></CardHeader><CardContent>{!conclusive ? <div className="callout callout--warning"><AlertTriangle /><div><strong>悬空情况未知</strong><p>只有完整、一致且关系已知的投影才能确认缺少实现声明或测试声明。</p></div></div> : floating.length === 0 ? <div className="healthy"><CheckCircle2 />没有悬空功能</div> : <RecordList aria-label="悬空功能">{floating.map(document => <RecordLink key={document.path} to={documentHref(document, snapshot.documents)}><div className="min-w-0"><strong>{document.metadata.title}</strong><span className="block text-sm text-muted-foreground break-all">{document.path}</span></div><div className="inline-badges"><Badge variant="outline">{humanKind(document.metadata.kind)}</Badge><Badge variant="secondary">缺少实现</Badge><Badge variant="secondary">缺少测试</Badge></div></RecordLink>)}</RecordList>}</CardContent></Card></>;
}

function Metric({ label, value, icon, href }: { label: string; value: number; icon: React.ReactNode; href: string }) { return <Link to={href} className="metric"><div>{icon}</div><strong>{value}</strong><span>{label}</span></Link>; }

import { contractIdentities, relatedTests, testDeclarationSummary } from '../lib/workspace-display.ts';
export { contractIdentities } from '../lib/workspace-display.ts';

import { useSourceNavigation } from '../hooks/use-url-navigation.ts';

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
export function TestingPanel({ document }: { document: WorkspaceDocument }) {
  const { snapshot, projection, act } = useWorkspace(); const [result, setResult] = useState<unknown>(null); const sourceNavigation = useSourceNavigation(); const [annotate, setAnnotate] = useState(false); const [contract, setContract] = useState(document.path); const [regressions, setRegressions] = useState('');
  const conclusive = projectionIsConclusive(projection);
  const cases = relatedTests(snapshot, document);
  const summary = testDeclarationSummary(snapshot, document);
  const annotation = async (event: React.FormEvent) => { event.preventDefault(); const value = await act({ action: 'test.marker', contract, issues: regressions.split('\n').filter(Boolean) }, '测试注释片段已生成。'); setResult(value); setAnnotate(false); };
  return <><PanelHeader title="测试" actions={<Button variant="outline" onClick={() => setAnnotate(true)}><Clipboard />生成注释</Button>} />{sourceNavigation.location && <Suspense fallback={null}><SourceDrawer location={sourceNavigation.location} onClose={sourceNavigation.close} /></Suspense>}<ScanNotice snapshot={snapshot} kind="tests" /><p className="muted">测试声明：{summary.count} 项；声明不表示覆盖率或功能完成。</p>{summary.untestedUseCases.length > 0 && <p>未关联测试的 Use Case：{summary.untestedUseCases.map(item => item.metadata.title).join("、")}</p>}<RecordList>{cases.map(item => { return <RecordItem key={item.id}><div className="card-title-row"><div><strong>{item.name}</strong></div><div className="inline-badges"><Badge variant={item.status === 'active' ? 'default' : 'secondary'}>{item.status}</Badge>{item.skipped && <Badge variant="outline">skipped</Badge>}</div></div><PathContextMenu path={item.file}><Button className="h-auto max-w-full whitespace-normal text-left px-0" variant="link" aria-label="查看测试源码" onClick={() => sourceNavigation.open({ path: item.file, line: item.line, endLine: item.line })}>{item.file}:{item.line}</Button></PathContextMenu><RecordDetails><dl><Definition label="Spec"><code>{item.contract}</code></Definition><Definition label="框架">{item.framework}</Definition>{item.issues.length > 0 && <Definition label="Issue">{item.issues.map(ref => <code key={ref}>{ref}</code>)}</Definition>}</dl></RecordDetails></RecordItem>; })}{conclusive && cases.length === 0 && scanFindings(snapshot, 'tests').length === 0 && (snapshot.project?.testRoots?.length ?? 0) > 0 && <li><PanelEmpty title="未发现当前 Spec 的关联测试" /></li>}</RecordList>{result !== null && <ResultCard title="生成结果" value={result} />}<Dialog open={annotate} onOpenChange={setAnnotate}><DialogContent><form onSubmit={event => settle(annotation(event))}><DialogHeader><DialogTitle>生成测试注释</DialogTitle><DialogDescription>生成供你粘贴到源码的注释片段，不会修改测试文件。</DialogDescription></DialogHeader><div className="form-grid"><Field label="Feature / Use Case 引用"><Input aria-label="测试 Spec 引用" value={contract} onChange={event => setContract(event.target.value)} required list="contract-references" /></Field><Field label="Issue" hint="每行一个引用"><Textarea aria-label="Issue 引用" value={regressions} onChange={event => setRegressions(event.target.value)} /></Field><datalist id="contract-references">{snapshot.documents.filter(doc => ['feature', 'use-case'].includes(doc.metadata.kind)).map(doc => <option key={doc.path} value={doc.path} />)}</datalist></div><DialogFooter><Button type="button" variant="outline" onClick={() => setAnnotate(false)}>取消</Button><Button type="submit">生成</Button></DialogFooter></form></DialogContent></Dialog></>;
}



const tools: readonly { title: string; description: string; action: ViewAction; icon: React.ReactNode }[] = [
  { title: '完整检查', description: '验证项目文档、关系与声明。', action: { action: 'check' }, icon: <CheckCircle2 /> },
  { title: 'Trace 检查', description: '检查派生关系图。', action: { action: 'trace.check' }, icon: <Activity /> },
  { title: 'Doctor', description: '给出配置和接入诊断，不运行测试。', action: { action: 'doctor' }, icon: <Stethoscope /> },
  { title: '恢复中断写入', description: '按 journal 规则恢复，不覆盖未知编辑。', action: { action: 'recover' }, icon: <Wrench /> },
  { title: 'Cache 状态', description: '查看可重建 HawDB 缓存。', action: { action: 'cache.status' }, icon: <Database /> },
  { title: '重建 Cache', description: '从源事实重新构建缓存。', action: { action: 'cache.rebuild' }, icon: <RefreshCw /> },
  { title: '清理 Cache', description: '清除可重建缓存，不删除证据或文档。', action: { action: 'cache.clear' }, icon: <Database /> },
];

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#主流程
export function ToolsPage() { const { snapshot, act } = useWorkspace(); const [result, setResult] = useState<unknown>(null); const [reference, setReference] = useState(''); const [template, setTemplate] = useState(snapshot.templates[0]?.name ?? ''); const [title, setTitle] = useState(''); const invoke = (action: ViewAction) => settle(act(action).then(setResult)); return <><PageHeader title="诊断与工具" description="在一个页面运行检查、诊断、审阅与模板工具。" actions={<Button asChild variant="outline"><Link to="/evidence">查看执行收据</Link></Button>} /><RecordList>{tools.map(tool => <RecordItem key={tool.title}><div className="card-title-row"><div><div className="inline-badges">{tool.icon}<strong>{tool.title}</strong></div><p className="muted mb-0">{tool.description}</p></div><Button variant="outline" aria-label={`运行${tool.title}`} onClick={() => invoke(tool.action)}>运行</Button></div></RecordItem>)}</RecordList><div className="dashboard-grid"><Card><CardHeader><CardTitle>定向 Trace / Review</CardTitle></CardHeader><CardContent><div className="form-grid"><Field label="引用（Review 可留空）"><Input aria-label="定向引用" value={reference} onChange={event => setReference(event.target.value)} /></Field><div className="button-row"><Button variant="outline" disabled={!reference} onClick={() => invoke({ action: 'trace.show', reference })}>查看 Trace</Button><Button variant="outline" onClick={() => invoke({ action: 'review', ...(reference ? { reference } : {}) })}>渲染 Review</Button></div></div></CardContent></Card><Card><CardHeader><CardTitle>模板</CardTitle></CardHeader><CardContent><div className="form-grid"><Field label="模板"><Select value={template} onValueChange={setTemplate}><SelectTrigger aria-label="模板"><SelectValue placeholder="选择模板" /></SelectTrigger><SelectContent>{snapshot.templates.map(item => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Field label="标题（可选）"><Input aria-label="模板标题" value={title} onChange={event => setTitle(event.target.value)} /></Field><Button variant="outline" disabled={!template} onClick={() => invoke({ action: 'template.show', name: template, ...(title ? { title } : {}) })}>查看模板</Button></div></CardContent></Card></div>{result !== null && <ResultCard title="运行结果" value={result} />}</>; }
