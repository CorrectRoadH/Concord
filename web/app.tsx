// @concord-file web-workbench-shell
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import {
  Activity, Boxes, Brain, ClipboardCheck, Code2, FlaskConical,
  GitBranch, Home, Layers3, Map, Menu, MessageSquareText, PanelTop, Search, Settings, Shapes, X,
} from 'lucide-react';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CloseMobileOnNavigate, DocumentNavigation } from './components/document-navigation';
import type { WorkspaceSnapshot } from '../src/view-contract';
import { DocumentsListPage, FeatureDetailPage, DocumentDetailPage, UseCaseDrawer } from './pages/documents';
import { EvidencePage, OverviewPage, ToolsPage } from './pages/operations';
import { SettingsPage } from './pages/settings';
import { GitPage } from './pages/git';
import { FeedbackDetailPage, FeedbackPage } from './pages/feedback';
import { ConcordApi } from './lib/api';
import { humanKind } from './lib/utils';
import { WorkspaceProvider, useWorkspace } from './workspace';
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
  { href: '/', label: '总览', icon: Home },
  { href: '/features', label: 'Feature', icon: Shapes },
  { href: '/engineering', label: 'Engineering', icon: Boxes },
  { href: '/roadmap', label: 'Roadmap', icon: Map },
  { href: '/design', label: 'Design', icon: Layers3 },
  { href: '/research', label: 'Research', icon: FlaskConical },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/feedback', label: '反馈', icon: MessageSquareText },
  { href: '/evidence', label: '证据', icon: Activity },
  { href: '/git', label: 'Git 变更', icon: GitBranch },
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
  const { snapshot } = useWorkspace(); const navigate = useNavigate(); const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(); if (!q) return [];
    const contractHref = (reference: string, tab: string) => { const path = reference.split('#')[0]; const ownerPath = snapshot.pages.find(page => page.path === path)?.documentPath ?? path; const owner = snapshot.documents.find(doc => doc.path === ownerPath); return owner ? `${documentHref(owner)}?tab=${tab}` : '/features'; };
    const documents = snapshot.documents.filter(doc => `${doc.metadata.title} ${doc.metadata.id} ${doc.path} ${doc.body}`.toLocaleLowerCase().includes(q)).map(doc => ({ key: doc.path, title: doc.metadata.title, detail: `${humanKind(doc.metadata.kind)} · ${doc.path}`, href: documentHref(doc) }));
    const cases = snapshot.cases.filter(item => `${item.id} ${item.name} ${item.file} ${item.contract}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `case:${item.id}`, title: item.name, detail: `测试 · ${item.id}`, href: contractHref(item.contract, 'testing') }));
    const codes = snapshot.codes.filter(item => `${item.id} ${item.file} ${item.symbol ?? ''} ${item.contracts.join(' ')}`.toLocaleLowerCase().includes(q)).map(item => ({ key: `code:${item.id}`, title: item.symbol ?? item.id, detail: `实现 · ${item.file}:${item.line}`, href: contractHref(item.contracts[0] ?? '', 'implementation') }));
    return [...documents, ...cases, ...codes].slice(0, 30);
  }, [query, snapshot]);
  const go = (href: string) => { onOpenChange(false); setQuery(''); navigate(href); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="search-dialog"><DialogHeader><DialogTitle>全局搜索</DialogTitle><DialogDescription>搜索契约、Feature 内的 Use Case、测试与实现声明。</DialogDescription></DialogHeader><div className="search-box"><Search size={18} /><Input aria-label="搜索工作区" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、ID、路径或正文…" /></div><div className="search-results">{query && results.length === 0 && <p className="muted">没有匹配内容。</p>}{results.map(item => <button key={item.key} onClick={() => go(item.href)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}</div></DialogContent></Dialog>;
}

function documentHref(doc: WorkspaceSnapshot['documents'][number]): string {
  const kind = doc.metadata.kind;
  if (kind === 'use-case') {
    const featureRef = doc.metadata.feature;
    const featureId = featureRef.split('/').filter(Boolean).at(-2) ?? featureRef;
    return `/features/${encodeURIComponent(featureId)}/use-cases/${encodeURIComponent(doc.metadata.id)}`;
  }
  const section: Record<string, string> = { feature: 'features', engineering: 'engineering', roadmap: 'roadmap', design: 'design', research: 'research', memory: 'memory', issue: 'feedback' };
  return `/${section[kind] ?? 'features'}/${encodeURIComponent(doc.metadata.id)}`;
}

function LegacyIssueRedirect() {
  const { id = '' } = useParams();
  return <Navigate to={`/feedback/${encodeURIComponent(id)}`} replace />;
}

function Shell() {
  const { snapshot, git, dirty, notices, clearNotice, flushAutoSave, setDirty } = useWorkspace();
  const location = useLocation(); const [searchOpen, setSearchOpen] = useState(false);
  const blocker = useBlocker(dirty);
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
  const gitCount = git?.entries.filter(entry => entry.path.startsWith('docs/') || entry.previousPath?.startsWith('docs/')).length ?? 0;
  return <SidebarProvider><Sidebar collapsible="icon"><SidebarHeader><div className="sidebar-brand"><div className="brand-mark brand-mark--small">C</div><div><strong>Concord</strong><span>{snapshot.root.split('/').filter(Boolean).at(-1) ?? '项目工作区'}</span></div></div></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>工作区</SidebarGroupLabel><SidebarMenu>{nav.map(item => { const Icon = item.icon; const active = item.href === '/' ? location.pathname === '/' : location.pathname.startsWith(item.href); return <SidebarMenuItem key={item.href}><SidebarMenuButton asChild isActive={active} tooltip={item.label}><CloseMobileOnNavigate href={item.href}><Icon /><span>{item.label}</span></CloseMobileOnNavigate></SidebarMenuButton>{item.href === '/git' && gitCount > 0 && <SidebarMenuBadge>{gitCount}</SidebarMenuBadge>}</SidebarMenuItem>; })}</SidebarMenu></SidebarGroup></SidebarContent><SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild isActive={location.pathname.startsWith('/tools')} tooltip="诊断与工具"><CloseMobileOnNavigate href="/tools"><PanelTop /><span>诊断与工具</span></CloseMobileOnNavigate></SidebarMenuButton></SidebarMenuItem><SidebarMenuItem><SidebarMenuButton asChild isActive={location.pathname.startsWith('/settings')} tooltip="项目设置"><CloseMobileOnNavigate href="/settings"><Settings /><span>项目设置</span></CloseMobileOnNavigate></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter><SidebarRail /></Sidebar><SidebarInset><header className="topbar"><SidebarTrigger><Menu /></SidebarTrigger><div className="breadcrumb">{breadcrumb(location.pathname)}</div><Button variant="outline" className="search-trigger" onClick={() => setSearchOpen(true)}><Search /><span>搜索工作区</span><kbd>⌘ K</kbd></Button>{dirty && <Badge variant="outline" className="dirty-badge">有未保存更改</Badge>}</header><div className="document-workspace"><DocumentNavigation /><div className={`page ${stylex.props(shellStyles.page).className ?? ''}`}><Routes><Route path="/" element={<OverviewPage />} /><Route path="/features" element={<DocumentsListPage kind="feature" />} /><Route path="/features/:id" element={<FeatureDetailPage />}><Route path="use-cases/:useCaseId" element={<UseCaseDrawer />} /></Route><Route path="/engineering" element={<DocumentsListPage kind="engineering" />} /><Route path="/engineering/:id" element={<DocumentDetailPage kind="engineering" />} /><Route path="/roadmap" element={<DocumentsListPage kind="roadmap" />} /><Route path="/roadmap/:id" element={<DocumentDetailPage kind="roadmap" />} /><Route path="/design" element={<DocumentsListPage kind="design" />} /><Route path="/design/:id" element={<DocumentDetailPage kind="design" />} /><Route path="/research" element={<DocumentsListPage kind="research" />} /><Route path="/research/:id" element={<DocumentDetailPage kind="research" />} /><Route path="/memory" element={<DocumentsListPage kind="memory" />} /><Route path="/memory/:id" element={<DocumentDetailPage kind="memory" />} /><Route path="/feedback" element={<FeedbackPage />} /><Route path="/feedback/:id" element={<FeedbackDetailPage />} /><Route path="/issues" element={<Navigate to="/feedback" replace />} /><Route path="/issues/:id" element={<LegacyIssueRedirect />} /><Route path="/evidence" element={<EvidencePage />} /><Route path="/git" element={<GitPage />} /><Route path="/tools" element={<ToolsPage />} /><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></div></div></SidebarInset><SearchDialog open={searchOpen} onOpenChange={setSearchOpen} /><div className="notices" aria-live="polite">{notices.map(notice => <button key={notice.id} className={`notice notice--${notice.tone}`} onClick={() => clearNotice(notice.id)}><span>{notice.text}</span><X size={16} /></button>)}</div><Dialog open={blocker.state === 'blocked' && saveBlocked}><DialogContent showCloseButton={false}><DialogHeader><DialogTitle>离开并丢弃未保存内容？</DialogTitle><DialogDescription>自动保存未完成或失败。留在此页可处理冲突或重试。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => blocker.reset?.()}>留在此页</Button><Button variant="destructive" onClick={() => { setDirty(false); blocker.proceed?.(); }}>丢弃并离开</Button></DialogFooter></DialogContent></Dialog></SidebarProvider>;
}

function breadcrumb(pathname: string): string {
  if (pathname === '/') return '项目总览';
  return pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment)).join(' / ');
}

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void new ConcordApi().workspace(controller.signal).then(
      value => { if (!controller.signal.aborted) setSnapshot(value); },
      cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); },
    );
    return () => controller.abort();
  }, [attempt]);
  if (!snapshot) return <main className="startup-page"><section className="startup-card"><div className="brand-mark">C</div><h1>{error ? '无法加载工作台' : '正在加载工作台…'}</h1>{error ? <><p role="alert">{error}</p><Button onClick={() => setAttempt(value => value + 1)}>重试</Button></> : <p role="status">正在读取项目工作区。</p>}</section></main>;
  return <WorkspaceProvider initial={snapshot}><ThemeToggle /><Shell /></WorkspaceProvider>;
}
