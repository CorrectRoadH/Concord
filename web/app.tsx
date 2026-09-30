// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import {
  Activity, BookOpen, Boxes, Brain, ClipboardCheck, Code2, FlaskConical,
  GitBranch, Home, Layers3, Map, Menu, MessageSquareText, PanelTop, Search, Settings, Shapes, SpellCheck, X,
} from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { documentHref } from './lib/document-routing';
import { WorkspaceHealthNotice } from './components/workspace-health-notice';
import { ProjectionStatus } from './components/projection-status';
import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigationScroll } from './hooks/use-navigation-scroll';
import { Link, Navigate, Route, Routes, useBlocker, useLocation, useNavigate } from 'react-router-dom';
import { CloseMobileOnNavigate, DocumentNavigation } from './components/document-navigation';
import type { WorkspaceProjection } from '../src/view-contract';
const DocumentsListPage = lazy(() => import('./pages/documents').then(module => ({ default: module.DocumentsListPage })));
const FeatureDetailPage = lazy(() => import('./pages/documents').then(module => ({ default: module.FeatureDetailPage })));
const DocumentDetailPage = lazy(() => import('./pages/documents').then(module => ({ default: module.DocumentDetailPage })));
const UseCaseDrawer = lazy(() => import('./pages/documents').then(module => ({ default: module.UseCaseDrawer })));
const ProjectDocsPage = lazy(() => import('./pages/project-docs').then(module => ({ default: module.ProjectDocsPage })));
const EvidencePage = lazy(() => import('./pages/operations').then(module => ({ default: module.EvidencePage })));
const OverviewPage = lazy(() => import('./pages/operations').then(module => ({ default: module.OverviewPage })));
const ToolsPage = lazy(() => import('./pages/operations').then(module => ({ default: module.ToolsPage })));
const SettingsPage = lazy(() => import('./pages/settings').then(module => ({ default: module.SettingsPage })));
const GitPage = lazy(() => import('./pages/git').then(module => ({ default: module.GitPage })));
const FeedbackDetailPage = lazy(() => import('./pages/feedback').then(module => ({ default: module.FeedbackDetailPage })));
const FeedbackNavigation = lazy(() => import('./pages/feedback').then(module => ({ default: module.FeedbackNavigation })));
const FeedbackPage = lazy(() => import('./pages/feedback').then(module => ({ default: module.FeedbackPage })));
const WritingPage = lazy(() => import('./pages/writing').then(module => ({ default: module.WritingPage })));
import { ApiError, ConcordApi } from './lib/api';
import { projectDocHref, projectDocPages, projectDocTitle } from './lib/project-docs';
import { humanKind } from './lib/utils';
import { projectionIsConclusive, WorkspaceProvider, useWorkspace } from './workspace';
import { ThemeToggle } from './theme';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { Input } from './components/ui/input';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from './components/ui/sidebar';

const nav = [
  { href: '/git', label: 'Git 变更', icon: GitBranch },
  { href: '/overview', label: '总览', icon: Home },
  { href: '/docs', label: '文档', icon: BookOpen },
  { href: '/writing', label: '写作', icon: SpellCheck },
  { href: '/terms', label: '术语', icon: BookOpen },
  { href: '/features', label: 'Feature', icon: Shapes },
  { href: '/engineering', label: 'Engineering', icon: Boxes },
  { href: '/roadmap', label: 'Roadmap', icon: Map },
  { href: '/design', label: 'Design', icon: Layers3 },
  { href: '/research', label: 'Research', icon: FlaskConical },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/feedback', label: '反馈', icon: MessageSquareText },
];

const shellStyles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    scrollbarWidth: 'none',
  },
});

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange(value: boolean): void }) {
  const { snapshot, projection } = useWorkspace(); const conclusive = projectionIsConclusive(projection); const navigate = useNavigate(); const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(); if (!q) return [];
    const contractHref = (reference: string, tab: string) => { const path = reference.split('#')[0]; const ownerPath = snapshot.pages.find(page => page.path === path)?.documentPath ?? path; const owner = snapshot.documents.find(doc => doc.path === ownerPath); return owner ? `${documentHref(owner, snapshot.documents)}?tab=${tab}` : '/features'; };
    const documents = snapshot.documents.filter(doc => `${doc.metadata.title} ${doc.metadata.id} ${doc.path}`.toLocaleLowerCase().includes(q)).map(doc => ({ key: doc.path, title: doc.metadata.title, detail: `${humanKind(doc.metadata.kind)} · ${doc.path}`, href: documentHref(doc, snapshot.documents) }));
    const projectDocs = projectDocPages(snapshot).filter(page => `${projectDocTitle(page)} ${page.path}`.toLocaleLowerCase().includes(q)).map(page => ({ key: page.path, title: projectDocTitle(page), detail: `文档 · ${page.path}`, href: projectDocHref(page.path) }));
    const cases = snapshot.cases.filter(item => `${item.id} ${item.name} ${item.file} ${item.contract}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `case:${item.id}`, title: item.name, detail: `测试 · ${item.id}`, href: contractHref(item.contract, 'testing') }));
    const codes = snapshot.codes.filter(item => `${item.id} ${item.file} ${item.symbol ?? ''} ${item.contracts.join(' ')}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `code:${item.id}`, title: item.symbol ?? `${item.file}:${item.line}`, detail: `实现 · ${item.file}:${item.line}`, href: contractHref(item.contracts[0] ?? '', 'implementation') }));
    const feedback = snapshot.feedback.filter(item => {
      const source = item.document.metadata.kind === 'issue' ? item.document.metadata.source : undefined;
      return [item.document.metadata.title, item.document.metadata.id, item.document.path, source?.title, source?.url, item.remote?.title, item.remote?.url]
        .filter(Boolean).join(' ').toLocaleLowerCase().includes(q);
    }).map(item => ({ key: item.document.path, title: item.document.metadata.title, detail: `反馈 · ${item.document.path}`, href: documentHref(item.document, snapshot.documents) }));
    return [...projectDocs, ...documents, ...feedback, ...cases, ...codes].slice(0, 30);
  }, [query, snapshot]);
  const go = (href: string) => { onOpenChange(false); setQuery(''); navigate(href); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="search-dialog"><DialogHeader><DialogTitle>全局搜索</DialogTitle><DialogDescription>搜索项目文档、契约、Feature 内的 Use Case、测试与实现声明。</DialogDescription></DialogHeader><div className="search-box"><Search size={18} /><Input aria-label="搜索工作区" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、ID 或路径…" /></div><div className="search-results">{query && results.length === 0 && <p className="muted">{conclusive ? '没有匹配内容。' : '当前代次未显示匹配项；投影可能不完整。'}</p>}{results.map(item => <button key={item.key} onClick={() => go(item.href)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}</div></DialogContent></Dialog>;
}

function Shell() {
  useNavigationScroll();
  const { snapshot, git, dirty, notices, clearNotice, flushAutoSave, discardAutoSave } = useWorkspace();
  const location = useLocation(); const [searchOpen, setSearchOpen] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !([currentLocation.pathname, nextLocation.pathname].every(path => path === '/writing' || path === '/terms')));
  const [saveBlocked, setSaveBlocked] = useState(false);
  useEffect(() => {
    if (blocker.state !== 'blocked') { setSaveBlocked(false); return; }
    let cancelled = false;
    setSaveBlocked(false);
    void flushAutoSave().then(saved => {
      if (cancelled) return;
      if (saved) blocker.proceed(); else setSaveBlocked(true);
    });
    return () => { cancelled = true; };
  }, [blocker.state, blocker.location, flushAutoSave]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true); } }; window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler); }, []);
  const gitCount = git?.entries.length ?? 0;
  return <SidebarProvider><Sidebar collapsible="icon"><SidebarHeader><div className="sidebar-brand"><div className="brand-mark brand-mark--small">C</div><div><strong>Concord</strong><span>{snapshot.root.split('/').filter(Boolean).at(-1) ?? '项目工作区'}</span></div></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>工作区</SidebarGroupLabel><SidebarMenu>{nav.map(item => { const Icon = item.icon; const active = item.href === '/' ? location.pathname === '/' : location.pathname.startsWith(item.href); return <SidebarMenuItem key={item.href}><SidebarMenuButton asChild isActive={active} tooltip={item.label}><CloseMobileOnNavigate href={item.href}><Icon /><span>{item.label}</span></CloseMobileOnNavigate></SidebarMenuButton>{item.href === '/git' && gitCount > 0 && <SidebarMenuBadge>{gitCount}</SidebarMenuBadge>}</SidebarMenuItem>; })}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild isActive={location.pathname.startsWith('/tools')} tooltip="诊断与工具"><CloseMobileOnNavigate href="/tools"><PanelTop /><span>诊断与工具</span></CloseMobileOnNavigate></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild isActive={location.pathname.startsWith('/settings')} tooltip="项目设置"><CloseMobileOnNavigate href="/settings"><Settings /><span>项目设置</span></CloseMobileOnNavigate></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter><SidebarRail /></Sidebar><SidebarInset><header className="topbar"><SidebarTrigger><Menu /></SidebarTrigger><div className="breadcrumb">{breadcrumb(location.pathname, location.search)}</div><Button variant="outline" className="search-trigger" onClick={() => setSearchOpen(true)}><Search /><span>搜索工作区</span><kbd>⌘ K</kbd></Button><ProjectionStatus />{dirty && <Badge variant="outline" className="dirty-badge">有未保存更改</Badge>}</header><div className="document-workspace"><DocumentNavigation />{(location.pathname === "/feedback" || location.pathname.startsWith("/feedback/")) && <Suspense fallback={null}><FeedbackNavigation /></Suspense>}<div id="content-navigation" /><div className={`page ${stylex.props(shellStyles.page).className ?? ''}`}><WorkspaceHealthNotice /><Suspense fallback={<p role="status">正在载入页面…</p>}><Routes><Route path="/" element={<Navigate to="/git" replace />} /><Route path="/overview" element={<OverviewPage />} /><Route path="/features" element={<DocumentsListPage kind="feature" />} /><Route path="/features/:id" element={<FeatureDetailPage />}><Route path="use-cases/:useCaseId" element={<UseCaseDrawer />} /></Route><Route path="/engineering" element={<DocumentsListPage kind="engineering" />} /><Route path="/engineering/:id" element={<DocumentDetailPage kind="engineering" />} /><Route path="/roadmap" element={<DocumentsListPage kind="roadmap" />} /><Route path="/roadmap/:id" element={<DocumentDetailPage kind="roadmap" />} /><Route path="/design" element={<DocumentsListPage kind="design" />} /><Route path="/design/:id" element={<DocumentDetailPage kind="design" />} /><Route path="/research" element={<DocumentsListPage kind="research" />} /><Route path="/research/:id" element={<DocumentDetailPage kind="research" />} /><Route path="/memory" element={<DocumentsListPage kind="memory" />} /><Route path="/memory/:id" element={<DocumentDetailPage kind="memory" />} /><Route path="/feedback" element={<FeedbackPage />} /><Route path="/feedback/:id" element={<FeedbackDetailPage />} /><Route path="/evidence" element={<EvidencePage />} /><Route path="/docs" element={<ProjectDocsPage />} /><Route element={<WritingPage />}><Route path="/writing" /><Route path="/terms" /></Route><Route path="/git" element={<GitPage />} /><Route path="/tools" element={<ToolsPage />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Suspense></div></div></SidebarInset><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} /><div className="notices" aria-live="polite">{notices.map(notice => <button key={notice.id} className={`notice notice--${notice.tone}`} onClick={() => clearNotice(notice.id)}><span>{notice.text}</span><X size={16} /></button>)}</div><Dialog open={blocker.state === 'blocked' && saveBlocked}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>离开并丢弃未保存内容？</DialogTitle><DialogDescription>{(location.pathname === '/writing' || location.pathname === '/terms') ? '写作规则与术语在点击保存后写入。留在此页可继续编辑或处理冲突。' : location.pathname === '/docs' && new URLSearchParams(location.search).get('file') === 'docs/constitution.md' ? '宪法修订尚未显式保存。留在此页可继续编辑或处理冲突。' : '自动保存未完成或失败。留在此页可处理冲突或重试。'}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => blocker.reset?.()}>留在此页</Button><Button variant="destructive" onClick={() => { void discardAutoSave().then(() => blocker.proceed?.()); }}>丢弃并离开</Button></DialogFooter></DialogContent></Dialog></SidebarProvider>;
}

function breadcrumb(pathname: string, search = ''): string {
  if (pathname === '/overview') return '项目总览';
  if (pathname === '/git') return '未提交变更';
  if (pathname === '/writing') return '写作';
  if (pathname === '/terms') return '术语';
  if (pathname === '/docs') {
    const file = new URLSearchParams(search).get('file');
    return file ? `文档 / ${file}` : '文档';
  }
  return pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment)).join(' / ');
}

/** Keep the workbench mounted while hiding an unreadable or identity-mismatched generation. */
function WorkspaceGate({ children }: { readonly children: ReactNode }) {
  const { workspaceIssue, refreshIssue, requestRefresh, act } = useWorkspace();
  const [working, setWorking] = useState(false);
  const blocking = workspaceIssue !== null;
  const pending = workspaceIssue?.code === 'WorkspaceProjectionPending';
  const recovering = workspaceIssue?.code === 'RecoveryRequired';
  const unavailable = workspaceIssue?.code === 'WorkspaceProjectionUnavailable';
  const cleanupFailed = workspaceIssue?.code === 'CleanupFailed';
  const canRetry = workspaceIssue?.code !== 'CleanupFailed';
  const retry = async () => {
    setWorking(true);
    try {
      if (recovering) await act({ action: 'recover' }, '恢复已执行，正在重新读取工作区。');
      else await requestRefresh();
    } catch { /* The provider keeps and renders the named response. */ }
    finally { setWorking(false); }
  };
  const title = pending ? '正在构建工作区投影…'
    : recovering ? '发布恢复阻断了工作区'
    : unavailable ? '工作区投影不可用'
    : cleanupFailed ? 'View 清理失败，需要重启'
    : '无法读取工作区';
  return <>
    <div hidden={blocking}>{children}</div>
    <main hidden={!blocking} className="startup-page"><section className="startup-card"><div className="brand-mark">C</div><h1>{title}</h1>
      {workspaceIssue && (pending
        ? <p role="status">当前配置身份尚无可读代次；每 2 秒重试一次，不展示上一身份的导航。</p>
        : <><p role="alert">{workspaceIssue.message}</p>{workspaceIssue.hint && <p className="muted">{workspaceIssue.hint}</p>}
          {cleanupFailed && <p className="muted">请重启 View 以便既有租约恢复协议回收现场；不要在当前进程内重试恢复。</p>}
          <p className="muted">错误码：{workspaceIssue.code}</p></>)}
      {refreshIssue && <div className="callout callout--warning"><strong>后台刷新请求失败，写入结果未因此改变</strong><p>{refreshIssue.code}：{refreshIssue.message}</p></div>}
      <Button hidden={!canRetry} disabled={working} variant={recovering ? 'default' : 'outline'} onClick={() => void retry()}>
        {working ? (recovering ? '正在恢复…' : '正在重试…') : recovering ? '恢复中断的发布' : pending || unavailable ? '重试刷新' : '重试'}
      </Button>
    </section></main>
  </>;
}

function failureDetails(details: unknown): { readonly hint?: string; readonly reason?: string } {
  if (typeof details !== 'object' || details === null) return {};
  const record = details as Record<string, unknown>;
  return {
    ...(typeof record.hint === 'string' && record.hint.length > 0 ? { hint: record.hint } : {}),
    ...(typeof record.reason === 'string' && record.reason.length > 0 ? { reason: record.reason } : {}),
  };
}

export function App() {
  const [api] = useState(() => new ConcordApi());
  const [data, setData] = useState<WorkspaceProjection | null>(null);
  const [error, setError] = useState<{ code: string; message: string; hint?: string; reason?: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api.workspace(controller.signal).then(
      value => { if (!controller.signal.aborted) { setData(value); setError(null); setBuilding(false); } },
      cause => {
        if (controller.signal.aborted) return;
        const code = cause instanceof ApiError ? cause.code : 'OperationFailed';
        if (code === 'WorkspaceProjectionPending') { setError(null); setBuilding(true); return; }
        setBuilding(false);
        setError({ code, message: cause instanceof Error ? cause.message : String(cause), ...(cause instanceof ApiError ? failureDetails(cause.details) : {}) });
      },
    );
    return () => controller.abort();
  }, [api, attempt]);
  // HawdbBusy is a short read-side lock collision: retry only the cached GET,
  // keeping the unavailable state visible while each request is in flight.
  useEffect(() => {
    if (data || error?.code !== 'WorkspaceProjectionUnavailable' || error.reason !== 'HawdbBusy') return undefined;
    const timer = window.setInterval(() => setAttempt(value => value + 1), 2000);
    return () => window.clearInterval(timer);
  }, [data, error?.code, error?.reason]);
  // The first generation has no cache; retry the poll-level read every two seconds.
  useEffect(() => {
    if (!building) return undefined;
    const timer = window.setInterval(() => setAttempt(value => value + 1), 2000);
    return () => window.clearInterval(timer);
  }, [building]);
  const retryRefresh = async () => { await api.requestWorkspaceRefresh().catch(() => undefined); setAttempt(value => value + 1); };
  const recover = () => {
    setRecovering(true);
    void api.action({ action: 'recover' }).then(
      result => {
        if (typeof result === 'object' && result !== null && 'status' in result && result.status === 'blocked') {
          setError({ code: 'CleanupFailed', message: '恢复仍被执行进程清理状态阻塞，现场已保留。发布前须确认进程清理。' });
        } else { setError(null); setAttempt(value => value + 1); }
      },
      cause => setError({ code: cause instanceof ApiError ? cause.code : 'OperationFailed', message: cause instanceof Error ? cause.message : String(cause), ...(cause instanceof ApiError ? failureDetails(cause.details) : {}) }),
    ).finally(() => setRecovering(false));
  };
  if (!data) {
    const needsRecovery = error?.code === 'RecoveryRequired';
    const cleanupFailed = error?.code === 'CleanupFailed';
    const heading = building ? '正在构建工作区投影…'
      : needsRecovery ? '发布被中断阻断'
      : cleanupFailed ? 'View 清理失败，需要重启'
      : error?.code === 'WorkspaceProjectionUnavailable' ? '工作区投影不可用'
      : error ? '无法加载工作台'
      : '正在加载工作台…';
    return <main className="startup-page"><section className="startup-card"><div className="brand-mark">C</div><h1>{heading}</h1>
      {building
        ? <><p role="status">首次构建可能需要最多 60 秒；工作台每 2 秒自动重试，不执行同步来源扫描。</p><Button variant="outline" onClick={() => void retryRefresh()}>立即重试</Button></>
        : error
          ? <><p role="alert">{error.message}</p>{error.hint && <p className="muted">{error.hint}</p>}<p className="muted">错误码：{error.code}{error.reason ? ` · 原因：${error.reason}` : ''}</p>
            {cleanupFailed && <p className="muted">请重启 View 以便既有租约恢复协议回收现场；不要在当前进程内重试恢复。</p>}
            {needsRecovery && <Button disabled={recovering} onClick={recover}>{recovering ? '正在恢复…' : '恢复中断的发布'}</Button>}
            {!cleanupFailed && <Button disabled={recovering} variant="outline" onClick={() => void retryRefresh()}>重试</Button>}
          </>
          : <p role="status">正在读取项目工作区。</p>}
    </section></main>;
  }
  return <WorkspaceProvider initial={data} api={api}><WorkspaceGate><ThemeToggle /><Shell /></WorkspaceGate></WorkspaceProvider>;
}
