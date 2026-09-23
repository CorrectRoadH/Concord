// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { DOCUMENT_NAME_PATTERN } from "../../src/document-name"
import { ExternalLink, GitPullRequestArrow, Link2, Plus, RefreshCw, Trash2 } from "lucide-react"
import * as React from "react"
import { ContentSidebar } from "@/components/content-sidebar"
import ReactMarkdown from "react-markdown"
import { Link, useMatch, useNavigate, useParams } from "react-router-dom"
import remarkGfm from "remark-gfm"

import type { FeedbackConnection, FeedbackItem, FeedbackSource } from "../../src/feedback-schema"
import type { ViewAction } from "../../src/view-contract"
import { connectionSummary } from "@/components/feedback-connections"
import { DocumentDetailPage } from "@/pages/documents"
import { Definition, Empty, Field } from "@/components/page"
import { PanelEmpty, PanelHeader } from "@/components/content-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { availabilityLabel, dateTime, feedbackProviderLabel, feedbackTriageLabel } from "@/lib/utils"
import { useWorkspace } from "@/workspace"

type ProviderFilter = "all" | "local" | FeedbackConnection["provider"]
type TriageFilter = "all" | FeedbackItem["triage"]
const fire = (task: Promise<unknown>): void => { void task.catch(() => undefined) }
const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
function receiptWarnings(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || !("warnings" in value) || !Array.isArray(value.warnings)) return []
  return value.warnings.filter((warning): warning is string => typeof warning === "string")
}

function sourceOf(item: FeedbackItem): FeedbackSource | undefined {
  return item.document.metadata.kind === "issue" ? item.document.metadata.source : undefined
}
function providerOf(item: FeedbackItem): FeedbackItem["provider"] {
  return item.provider
}
function searchText(item: FeedbackItem): string {
  const source = sourceOf(item)
  return [item.document.metadata.id, item.document.metadata.title, item.document.body, item.remote?.title, item.remote?.body, item.remote?.url, source?.title, source?.body, source?.url, providerOf(item)].filter(Boolean).join(" ").toLocaleLowerCase()
}
function CreateLocalFeedback() {
  const { act, busy } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [error, setError] = React.useState("")
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setError("")
    try {
      await act({ action: "document.create", kind: "issue", id, title, ...(body ? { body } : {}) }, "本地反馈已创建。")
      setOpen(false); setId(""); setTitle(""); setBody("")
    } catch (cause) { setError(errorMessage(cause)) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline"><Plus /> 新建本地反馈</Button></DialogTrigger><DialogContent><form onSubmit={(event) => fire(submit(event))}><DialogHeader><DialogTitle>新建本地反馈</DialogTitle><DialogDescription>创建不依赖远端来源的 Issue 草稿；之后可关联 Feature、Memory 并正常关闭。</DialogDescription></DialogHeader><div className="form-grid"><Field label="ID" hint="中文等 Unicode 字母、数字，可用单连字符分隔"><Input aria-label="本地反馈 ID" value={id} onChange={(event) => setId(event.target.value)} pattern={DOCUMENT_NAME_PATTERN.source} required /></Field><Field label="标题"><Input aria-label="本地反馈标题" value={title} onChange={(event) => setTitle(event.target.value)} required /></Field><Field label="初始正文" hint="本地正文可继续自由编辑"><Textarea aria-label="本地反馈正文" value={body} onChange={(event) => setBody(event.target.value)} /></Field>{error && <div className="form-error" role="alert">{error}</div>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "创建中…" : "创建"}</Button></DialogFooter></form></DialogContent></Dialog>
}

function ImportFeedback({ connections, onReceipt }: { connections: readonly FeedbackConnection[]; onReceipt(warnings: readonly string[]): void }) {
  const { act, busy } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const [connection, setConnection] = React.useState(connections[0]?.id ?? "")
  const [url, setUrl] = React.useState("")
  const [error, setError] = React.useState("")
  React.useEffect(() => { if (!connections.some((item) => item.id === connection)) setConnection(connections[0]?.id ?? "") }, [connection, connections])
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault(); setError("")
    try { const receipt = await act({ action: "feedback.sync", connection, url }, "远端反馈已导入。"); onReceipt(receiptWarnings(receipt)); setOpen(false); setUrl("") }
    catch (cause) { setError(errorMessage(cause)) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button disabled={connections.length === 0}><GitPullRequestArrow /> 从 URL 导入</Button></DialogTrigger><DialogContent><form onSubmit={(event) => fire(submit(event))}><DialogHeader><DialogTitle>从远端 URL 导入</DialogTitle><DialogDescription>URL 必须属于所选连接支持的 GitHub 或 Linear 主机。导入只在提交后发起网络请求。</DialogDescription></DialogHeader><div className="form-grid"><Field label="连接"><Select value={connection} onValueChange={setConnection}><SelectTrigger aria-label="导入连接"><SelectValue placeholder="选择连接" /></SelectTrigger><SelectContent>{connections.map((item) => <SelectItem key={item.id} value={item.id}>{item.id} · {connectionSummary(item)}</SelectItem>)}</SelectContent></Select></Field><Field label="远端 Issue URL"><Input aria-label="远端 Issue URL" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://github.com/owner/repo/issues/123" required /></Field>{error && <div className="form-error" role="alert">{error}</div>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !connection}>{busy ? "导入中…" : "导入"}</Button></DialogFooter></form></DialogContent></Dialog>
}

function FeedbackSources({ connections, onReceipt }: { connections: readonly FeedbackConnection[]; onReceipt(warnings: readonly string[]): void }) {
  const { act, busy } = useWorkspace()
  const [active, setActive] = React.useState<string | null>(null)
  const [errors, setErrors] = React.useState<Readonly<Record<string, string>>>({})
  async function sync(connection: FeedbackConnection): Promise<void> {
    setActive(connection.id)
    setErrors((current) => ({ ...current, [connection.id]: "" }))
    try { const receipt = await act({ action: "feedback.sync", connection: connection.id }, `${connection.id} 已同步。`); onReceipt(receiptWarnings(receipt)) }
    catch (cause) { setErrors((current) => ({ ...current, [connection.id]: errorMessage(cause) })) }
    finally { setActive(null) }
  }
  return <div className="feedback-source-status"><span>{connections.length === 0 ? "尚未配置远端来源" : `${connections.length} 个远端来源`}</span>{connections.map((connection) => <span className="feedback-source-status__connection" key={connection.id}><Badge variant="outline">{feedbackProviderLabel(connection.provider)}</Badge><span>{connectionSummary(connection)}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => fire(sync(connection))}><RefreshCw /> {active === connection.id ? "同步中…" : "同步"}</Button>{errors[connection.id] && <span className="feedback-source-status__error" role="alert">{errors[connection.id]}</span>}</span>)}<Link to="/settings?tab=feedback">管理反馈来源</Link></div>
}

export function FeedbackNavigation() {
  const { snapshot } = useWorkspace()
  const id = useMatch("/feedback/:id")?.params.id
  const feedback = snapshot.feedback
  const [query, setQuery] = React.useState("")
  const [provider, setProvider] = React.useState<ProviderFilter>("all")
  const [triage, setTriage] = React.useState<TriageFilter>("all")
  const normalized = query.trim().toLocaleLowerCase()
  const visible = feedback.filter((item) => (provider === "all" || providerOf(item) === provider) && (triage === "all" || item.triage === triage) && (!normalized || searchText(item).includes(normalized)))
  return <ContentSidebar model={{ label: '反馈', title: '反馈',
    back: id ? { title: '返回反馈列表', href: '/feedback' } : undefined,
    filter: feedback.length ? { label: '搜索反馈', placeholder: '搜索标题、ID、正文或来源 URL…', value: query, onChange: setQuery } : undefined,
    groups: [{ id: 'feedback', label: '反馈列表', items: visible.map(item => ({
      id: item.document.path, title: item.document.metadata.title, href: `/feedback/${encodeURIComponent(item.document.metadata.id)}`,
      active: item.document.metadata.id === id, searchText: searchText(item),
      suffix: <span className="text-xs text-muted-foreground">{feedbackTriageLabel(item.triage)} · {feedbackProviderLabel(item.provider)}{item.warnings.length > 0 && <span title={item.warnings.join("；")}> · 有提醒</span>}</span>,
    })), filterable: false, emptyMessage: feedback.length ? '没有匹配的反馈' : '还没有反馈',
    actions: feedback.length > 0 ? <div className="feedback-toolbar"><Select value={provider} onValueChange={(value) => setProvider(value as ProviderFilter)}><SelectTrigger aria-label="按来源筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem><SelectItem value="local">仅本地</SelectItem><SelectItem value="github">GitHub</SelectItem><SelectItem value="linear">Linear</SelectItem></SelectContent></Select><Select value={triage} onValueChange={(value) => setTriage(value as TriageFilter)}><SelectTrigger aria-label="按处理状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部处理状态</SelectItem><SelectItem value="pending">待处理</SelectItem><SelectItem value="linked">已关联</SelectItem><SelectItem value="closed">已关闭</SelectItem></SelectContent></Select></div> : undefined,
    }],
  }} />
}

export function FeedbackPage() {
  const { snapshot } = useWorkspace()
  const feedback = snapshot.feedback
  const connections = snapshot.project?.feedbackConnections ?? []
  const [receiptNotices, setReceiptNotices] = React.useState<readonly string[]>([])
  return <><div role="toolbar" aria-label="反馈操作" className="button-row justify-end mb-3"><CreateLocalFeedback />{connections.length > 0 && <ImportFeedback connections={connections} onReceipt={setReceiptNotices} />}</div>
    <FeedbackSources connections={connections} onReceipt={setReceiptNotices} />
    {receiptNotices.length > 0 && <div className="callout callout--warning feedback-receipt-warnings"><div><strong>同步已完成，但有提醒</strong>{receiptNotices.map((warning) => <p key={warning}>{warning}</p>)}</div><Button size="sm" variant="ghost" onClick={() => setReceiptNotices([])}>关闭</Button></div>}
    {feedback.length === 0 ? <PanelEmpty title="新建第一条反馈">新建本地反馈，或前往<Link to="/settings?tab=feedback">反馈来源设置</Link>添加连接。</PanelEmpty> : <PanelEmpty title="选择反馈">从内容导航选择反馈，查看正文、来源与处理状态。</PanelEmpty>}

  </>
}

function SourcePanel({ item }: { item: FeedbackItem }) {
  const source = sourceOf(item); const remote = item.remote
  if (!source) return <Card className="feedback-source-card"><CardHeader><CardTitle>来源</CardTitle><CardDescription>这是本地创建的反馈，没有远端来源快照。</CardDescription></CardHeader></Card>
  return <Card className="feedback-source-card"><CardHeader><div className="card-title-row"><div><CardTitle>远端来源（只读）</CardTitle><CardDescription>“上次观察缓存”来自最近一次成功同步，不代表远端实时最新；页面只展示已保存的信息。</CardDescription></div><Button asChild size="sm" variant="outline"><a href={source.url} target="_blank" rel="noreferrer"><ExternalLink /> 打开远端</a></Button></div></CardHeader><CardContent><div className="feedback-source-facts"><Definition label="来源">{feedbackProviderLabel(source.provider)}</Definition><Definition label="连接"><code>{source.connectionId}</code></Definition><Definition label="远端 ID"><code>{source.id}</code></Definition><Definition label="本地状态"><Badge variant="outline">{item.document.metadata.state}</Badge></Definition><Definition label="可用性">{availabilityLabel(item.availability)}</Definition></div><div className="feedback-source-snapshots"><section><div className="feedback-snapshot-heading"><div><strong>首次导入快照</strong><small>永久保留，不被刷新替换</small></div><span>{dateTime(source.updatedAt)}</span></div><Badge variant="outline">远端状态：{source.state}</Badge><article className="feedback-source-markdown"><h3>{source.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{source.body}</ReactMarkdown></article><small>导入于 {dateTime(source.importedAt)}</small></section><section><div className="feedback-snapshot-heading"><div><strong>上次观察缓存</strong><small>非实时；只表示最近成功观察</small></div><span>{remote ? dateTime(remote.updatedAt) : "不可用"}</span></div>{remote ? <><Badge variant="secondary">远端状态：{remote.state}</Badge><article className="feedback-source-markdown"><h3>{remote.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{remote.body}</ReactMarkdown></article></> : <p className="muted">当前没有可读的远端缓存；首次导入快照仍可用。</p>}</section></div>{item.warnings.length > 0 && <div className="callout callout--warning"><div><strong>来源提醒</strong>{item.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}</CardContent></Card>
}

function RemoveLocalDraft({ item }: { item: FeedbackItem }) {
  const { snapshot, act, busy } = useWorkspace()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState("")
  const metadata = item.document.metadata
  const candidate = item.provider === "local" && metadata.state === "draft" && metadata.source === undefined && metadata.origin === undefined && metadata.closure === undefined && metadata.history.length === 0 && metadata.memoryRelations.length === 0 && metadata.adoptions.current.length === 0 && metadata.adoptions.history.length === 0
  const incoming = snapshot.edges.some((edge) => edge.from !== item.document.path && [item.document.path, metadata.id].includes(edge.to.split("#")[0] ?? ""))
  if (!candidate || incoming || snapshot.findings.length > 0) return null
  async function remove(): Promise<void> {
    setError("")
    try {
      await act({ action: "issue.remove", id: item.document.path, expectedDigest: item.document.digest }, "本地草稿已删除。")
      setOpen(false)
      navigate("/feedback")
    } catch (cause) { setError(errorMessage(cause)) }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Trash2 /> 删除本地草稿</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>删除本地草稿</DialogTitle><DialogDescription>将删除 {metadata.title} 的本地 Issue 文件。已有来源、关系或历史的记录不能删除。</DialogDescription></DialogHeader>{error && <div className="form-error" role="alert">{error}</div>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => fire(remove())}>删除</Button></DialogFooter></DialogContent></Dialog>
}

function FeatureLinker({ item }: { item: FeedbackItem }) {
  const { snapshot, act, busy } = useWorkspace()
  const features = snapshot.documents.filter((document) => document.metadata.kind === "feature")
  const linked = item.document.metadata.kind === "issue" ? item.document.metadata.adoptions.current : []
  const available = features.filter((candidate) => !linked.some((reference) => reference === candidate.path || reference === candidate.metadata.id))
  const [feature, setFeature] = React.useState(available[0]?.path ?? "")
  const [error, setError] = React.useState("")
  React.useEffect(() => { if (!available.some((candidate) => candidate.path === feature)) setFeature(available[0]?.path ?? "") }, [available, feature])
  async function linkFeature(): Promise<void> {
    setError("")
    try { const action: ViewAction = { action: "feedback.link", id: item.document.metadata.id, feature }; await act(action, "反馈已关联 Feature。") }
    catch (cause) { setError(errorMessage(cause)) }
  }
  return <Card className="feedback-feature-card"><CardHeader><CardTitle>Feature 关联</CardTitle><CardDescription>关联后处理状态会变为“已关联”；Memory 关系和关闭操作在生命周期页签中维护。</CardDescription></CardHeader><CardContent>{linked.length > 0 && <div className="tag-list">{linked.map((reference) => <code key={reference}>{reference}</code>)}</div>}{available.length > 0 ? <div className="feedback-link-row"><Select value={feature} onValueChange={setFeature}><SelectTrigger aria-label="关联 Feature"><SelectValue placeholder="选择 Feature" /></SelectTrigger><SelectContent>{available.map((candidate) => <SelectItem key={candidate.path} value={candidate.path}>{candidate.metadata.title} · {candidate.metadata.id}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={busy || !feature} onClick={() => fire(linkFeature())}><Link2 /> 关联 Feature</Button></div> : <p className="muted">{features.length === 0 ? "项目中还没有 Feature。" : "已关联所有可用 Feature。"}</p>}{error && <div className="form-error" role="alert">{error}</div>}</CardContent></Card>
}

export function FeedbackDetailPage() {
  const { id = "" } = useParams(); const { snapshot } = useWorkspace()
  const item = snapshot.feedback.find((candidate) => candidate.document.metadata.id === id)
  if (!item) return <Empty kind="missing" title="找不到反馈">它可能已被移动、删除或尚未导入。</Empty>
  return <><DocumentDetailPage kind="issue" relatedContent={<><PanelHeader title="来源与关联" /><RemoveLocalDraft item={item} /><div className="feedback-detail-context"><SourcePanel item={item} /><FeatureLinker item={item} /></div></>} /></>
}
