// @concord-file feedback-workbench
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { ExternalLink, GitPullRequestArrow, Link2, Plus, RefreshCw, Trash2 } from "lucide-react"
import * as React from "react"
import ReactMarkdown from "react-markdown"
import { Link, useParams } from "react-router-dom"
import remarkGfm from "remark-gfm"

import type { FeedbackConnection, FeedbackItem, FeedbackSource } from "../../src/feedback-schema"
import type { ProjectConfig } from "../../src/shared"
import type { ViewAction } from "../../src/view-contract"
import { DocumentDetailPage } from "@/pages/documents"
import { Definition, Empty, Field, PageHeader } from "@/components/page"
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
function providerOf(item: FeedbackItem): FeedbackConnection["provider"] | null {
  return item.remote?.provider ?? sourceOf(item)?.provider ?? null
}
function remoteStateOf(item: FeedbackItem): string | null {
  return item.remote?.state ?? sourceOf(item)?.state ?? null
}
function searchText(item: FeedbackItem): string {
  const source = sourceOf(item)
  return [item.document.metadata.id, item.document.metadata.title, item.document.body, item.remote?.title, item.remote?.body, item.remote?.url, source?.title, source?.body, source?.url, providerOf(item)].filter(Boolean).join(" ").toLocaleLowerCase()
}
function connectionSummary(connection: FeedbackConnection): string {
  return connection.provider === "github" ? `${connection.owner}/${connection.repo}` : connection.team
}
function connectionBinding(connection: FeedbackConnection): string {
  if (connection.provider === "github") return connection.repositoryId ? `repository ${connection.repositoryId}` : "首次成功同步时绑定 repository ID"
  return connection.organizationId && connection.teamId ? `organization ${connection.organizationId} · team ${connection.teamId}` : "首次成功同步时绑定 organization/team ID"
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
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline"><Plus /> 新建本地反馈</Button></DialogTrigger><DialogContent><form onSubmit={(event) => fire(submit(event))}><DialogHeader><DialogTitle>新建本地反馈</DialogTitle><DialogDescription>创建不依赖远端来源的 Issue 草稿；之后可关联 Feature、Memory 并正常关闭。</DialogDescription></DialogHeader><div className="form-grid"><Field label="ID" hint="小写字母、数字和单连字符"><Input aria-label="本地反馈 ID" value={id} onChange={(event) => setId(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></Field><Field label="标题"><Input aria-label="本地反馈标题" value={title} onChange={(event) => setTitle(event.target.value)} required /></Field><Field label="初始正文" hint="本地正文可继续自由编辑"><Textarea aria-label="本地反馈正文" value={body} onChange={(event) => setBody(event.target.value)} /></Field>{error && <div className="form-error" role="alert">{error}</div>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? "创建中…" : "创建"}</Button></DialogFooter></form></DialogContent></Dialog>
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

function AddConnection() {
  const { snapshot, act, busy } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const [baseline, setBaseline] = React.useState<{ readonly config: ProjectConfig; readonly digest: string; readonly connections: readonly FeedbackConnection[] } | null>(null)
  const [id, setId] = React.useState("")
  const [provider, setProvider] = React.useState<FeedbackConnection["provider"]>("github")
  const [credentialEnv, setCredentialEnv] = React.useState("")
  const [owner, setOwner] = React.useState("")
  const [repo, setRepo] = React.useState("")
  const [team, setTeam] = React.useState("")
  const [error, setError] = React.useState("")
  function loadCurrent(): void {
    if (!snapshot.project || !snapshot.configDigest) return
    setBaseline({ config: snapshot.project, digest: snapshot.configDigest, connections: snapshot.project.feedbackConnections ?? [] })
    setError("")
  }
  function changeOpen(next: boolean): void {
    if (next) loadCurrent()
    setOpen(next)
  }
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!baseline) return
    const connection: FeedbackConnection = provider === "github" ? { id, provider, credentialEnv, owner, repo } : { id, provider, credentialEnv, team }
    setError("")
    try {
      await act({ action: "config.set", config: { ...baseline.config, feedbackConnections: [...baseline.connections, connection] }, expectedDigest: baseline.digest }, "反馈连接已添加。")
      setOpen(false); setId(""); setCredentialEnv(""); setOwner(""); setRepo(""); setTeam("")
    } catch (cause) { setError(errorMessage(cause)) }
  }
  return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> 添加连接</Button></DialogTrigger><DialogContent><form onSubmit={(event) => fire(submit(event))}><DialogHeader><DialogTitle>添加反馈连接</DialogTitle><DialogDescription>这里只保存凭据的环境变量名，不接收或保存 token。打开表单时已冻结完整配置版本；冲突时不会丢失当前草稿。</DialogDescription></DialogHeader><div className="form-grid"><Field label="连接 ID" hint="小写字母、数字和单连字符"><Input aria-label="连接 ID" value={id} onChange={(event) => setId(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></Field><Field label="来源"><Select value={provider} onValueChange={(value) => setProvider(value as FeedbackConnection["provider"])}><SelectTrigger aria-label="连接来源"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="github">GitHub</SelectItem><SelectItem value="linear">Linear</SelectItem></SelectContent></Select></Field><Field label="凭据环境变量" hint={provider === "linear" ? "Linear personal API key 的环境变量名，例如 LINEAR_API_KEY；不要填写 token。" : "GitHub token 的环境变量名，例如 GITHUB_TOKEN；不要填写 token。"}><Input aria-label="凭据环境变量" value={credentialEnv} onChange={(event) => setCredentialEnv(event.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder={provider === "linear" ? "LINEAR_API_KEY" : "GITHUB_TOKEN"} required /></Field>{provider === "github" ? <div className="two-column"><Field label="Owner"><Input aria-label="GitHub owner" value={owner} onChange={(event) => setOwner(event.target.value)} required /></Field><Field label="Repository"><Input aria-label="GitHub repository" value={repo} onChange={(event) => setRepo(event.target.value)} required /></Field></div> : <Field label="Team" hint="由首次同步解析并绑定 team ID。"><Input aria-label="Linear team" value={team} onChange={(event) => setTeam(event.target.value)} required /></Field>}{error && <div className="form-error" role="alert">{error}</div>}</div><DialogFooter><Button type="button" variant="ghost" onClick={loadCurrent}>载入当前配置</Button><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !baseline}>{busy ? "保存中…" : "添加"}</Button></DialogFooter></form></DialogContent></Dialog>
}

function Connections({ connections, onReceipt }: { connections: readonly FeedbackConnection[]; onReceipt(warnings: readonly string[]): void }) {
  const { snapshot, act, busy } = useWorkspace()
  const [errors, setErrors] = React.useState<Readonly<Record<string, string>>>({})
  async function sync(connection: FeedbackConnection): Promise<void> {
    setErrors((current) => ({ ...current, [connection.id]: "" }))
    try { const receipt = await act({ action: "feedback.sync", connection: connection.id }, `${connection.id} 已同步。`); onReceipt(receiptWarnings(receipt)) }
    catch (cause) { setErrors((current) => ({ ...current, [connection.id]: errorMessage(cause) })) }
  }
  async function remove(connection: FeedbackConnection): Promise<void> {
    if (!snapshot.project || !snapshot.configDigest) return
    setErrors((current) => ({ ...current, [connection.id]: "" }))
    try { await act({ action: "config.set", config: { ...snapshot.project, feedbackConnections: connections.filter((item) => item.id !== connection.id) }, expectedDigest: snapshot.configDigest }, `${connection.id} 已移除。`) }
    catch (cause) { setErrors((current) => ({ ...current, [connection.id]: errorMessage(cause) })) }
  }
  return <Card className="feedback-connections"><CardHeader><div className="card-title-row"><div><CardTitle>远端来源连接</CardTitle><CardDescription>页面展示已保存的信息；点击同步或从 URL 导入时才会获取远端变化。</CardDescription></div><AddConnection /></div></CardHeader><CardContent>{connections.length === 0 ? <p className="muted">尚未配置连接。添加连接时只填写凭据环境变量名。</p> : <div className="connection-list">{connections.map((connection) => <div key={connection.id} className="connection-record"><div><div className="inline-badges"><strong>{connection.id}</strong><Badge variant="outline">{feedbackProviderLabel(connection.provider)}</Badge></div><span>{connectionSummary(connection)} · <code>{connection.credentialEnv}</code></span><small>{connectionBinding(connection)}</small>{errors[connection.id] && <div className="form-error" role="alert">{errors[connection.id]}</div>}</div><div className="button-row"><Button size="sm" variant="outline" disabled={busy} onClick={() => fire(sync(connection))}><RefreshCw /> 同步</Button><Button size="icon-sm" variant="ghost" aria-label={`移除连接 ${connection.id}`} title="移除连接" disabled={busy} onClick={() => fire(remove(connection))}><Trash2 /></Button></div></div>)}</div>}</CardContent></Card>
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  const provider = providerOf(item); const source = sourceOf(item)
  return <Link to={`/feedback/${encodeURIComponent(item.document.metadata.id)}`} className="card-link"><Card><CardHeader><div className="card-title-row"><CardTitle>{item.document.metadata.title}</CardTitle><Badge variant={item.triage === "pending" ? "default" : "outline"}>{feedbackTriageLabel(item.triage)}</Badge></div><CardDescription>{item.document.metadata.id}</CardDescription></CardHeader><CardContent className="feedback-card-content"><p>{item.document.body.slice(0, 160) || source?.body.slice(0, 160) || "等待补充本地上下文"}</p><div className="inline-badges">{provider && <Badge variant="secondary">{feedbackProviderLabel(provider)}</Badge>}<Badge variant="outline">本地：{item.document.metadata.kind === "issue" ? item.document.metadata.state : "—"}</Badge>{remoteStateOf(item) && <Badge variant="outline">远端：{remoteStateOf(item)}</Badge>}<Badge variant="outline">{availabilityLabel(item.availability)}</Badge></div>{item.warnings.length > 0 && <small className="feedback-warning">{item.warnings.join("；")}</small>}</CardContent></Card></Link>
}

export function FeedbackPage() {
  const { snapshot } = useWorkspace()
  const feedback = snapshot.feedback
  const connections = snapshot.project?.feedbackConnections ?? []
  const [query, setQuery] = React.useState("")
  const [provider, setProvider] = React.useState<ProviderFilter>("all")
  const [triage, setTriage] = React.useState<TriageFilter>("all")
  const [receiptNotices, setReceiptNotices] = React.useState<readonly string[]>([])
  const normalized = query.trim().toLocaleLowerCase()
  const visible = feedback.filter((item) => (provider === "all" || (provider === "local" ? providerOf(item) === null : providerOf(item) === provider)) && (triage === "all" || item.triage === triage) && (!normalized || searchText(item).includes(normalized)))
  return <><PageHeader eyebrow="反馈收件箱" title="反馈" description="汇总本地草稿与 GitHub、Linear 来源；本地正文和状态独立维护，不会被远端刷新覆盖。" actions={<><CreateLocalFeedback /><ImportFeedback connections={connections} onReceipt={setReceiptNotices} /></>} /><Connections connections={connections} onReceipt={setReceiptNotices} />{receiptNotices.length > 0 && <div className="callout callout--warning feedback-receipt-warnings"><div><strong>同步已完成，但有提醒</strong>{receiptNotices.map((warning) => <p key={warning}>{warning}</p>)}</div><Button size="sm" variant="ghost" onClick={() => setReceiptNotices([])}>关闭</Button></div>}<div className="feedback-toolbar"><Input aria-label="搜索反馈" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、ID、正文或来源 URL…" /><Select value={provider} onValueChange={(value) => setProvider(value as ProviderFilter)}><SelectTrigger aria-label="按来源筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem><SelectItem value="local">仅本地</SelectItem><SelectItem value="github">GitHub</SelectItem><SelectItem value="linear">Linear</SelectItem></SelectContent></Select><Select value={triage} onValueChange={(value) => setTriage(value as TriageFilter)}><SelectTrigger aria-label="按处理状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部处理状态</SelectItem><SelectItem value="pending">待处理</SelectItem><SelectItem value="linked">已关联</SelectItem><SelectItem value="closed">已关闭</SelectItem></SelectContent></Select><Badge variant="secondary">{visible.length} / {feedback.length} 项</Badge></div>{visible.length === 0 ? <Empty title={feedback.length === 0 ? "还没有反馈" : "没有匹配的反馈"}>{feedback.length === 0 ? "新建本地反馈，或配置连接后显式同步。" : "调整搜索词或筛选条件。"}</Empty> : <div className="card-grid">{visible.map((item) => <FeedbackCard key={item.document.path} item={item} />)}</div>}</>
}

function SourcePanel({ item }: { item: FeedbackItem }) {
  const source = sourceOf(item); const remote = item.remote
  if (!source) return <Card className="feedback-source-card"><CardHeader><CardTitle>来源</CardTitle><CardDescription>这是本地创建的反馈，没有远端来源快照。</CardDescription></CardHeader></Card>
  return <Card className="feedback-source-card"><CardHeader><div className="card-title-row"><div><CardTitle>远端来源（只读）</CardTitle><CardDescription>“上次观察缓存”来自最近一次成功同步，不代表远端实时最新；页面只展示已保存的信息。</CardDescription></div><Button asChild size="sm" variant="outline"><a href={source.url} target="_blank" rel="noreferrer"><ExternalLink /> 打开远端</a></Button></div></CardHeader><CardContent><div className="feedback-source-facts"><Definition label="来源">{feedbackProviderLabel(source.provider)}</Definition><Definition label="连接"><code>{source.connectionId}</code></Definition><Definition label="远端 ID"><code>{source.id}</code></Definition><Definition label="本地状态"><Badge variant="outline">{item.document.metadata.state}</Badge></Definition><Definition label="可用性">{availabilityLabel(item.availability)}</Definition></div><div className="feedback-source-snapshots"><section><div className="feedback-snapshot-heading"><div><strong>首次导入快照</strong><small>永久保留，不被刷新替换</small></div><span>{dateTime(source.updatedAt)}</span></div><Badge variant="outline">远端状态：{source.state}</Badge><article className="feedback-source-markdown"><h3>{source.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{source.body}</ReactMarkdown></article><small>导入于 {dateTime(source.importedAt)}</small></section><section><div className="feedback-snapshot-heading"><div><strong>上次观察缓存</strong><small>非实时；只表示最近成功观察</small></div><span>{remote ? dateTime(remote.updatedAt) : "不可用"}</span></div>{remote ? <><Badge variant="secondary">远端状态：{remote.state}</Badge><article className="feedback-source-markdown"><h3>{remote.title}</h3><ReactMarkdown remarkPlugins={[remarkGfm]}>{remote.body}</ReactMarkdown></article></> : <p className="muted">当前没有可读的远端缓存；首次导入快照仍可用。</p>}</section></div>{item.warnings.length > 0 && <div className="callout callout--warning"><div><strong>来源提醒</strong>{item.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}</CardContent></Card>
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
  return <Card className="feedback-feature-card"><CardHeader><CardTitle>Feature 关联</CardTitle><CardDescription>关联后处理状态会变为“已关联”；Memory 关系和关闭操作仍在上方本地文档的生命周期页签中维护。</CardDescription></CardHeader><CardContent>{linked.length > 0 && <div className="tag-list">{linked.map((reference) => <code key={reference}>{reference}</code>)}</div>}{available.length > 0 ? <div className="feedback-link-row"><Select value={feature} onValueChange={setFeature}><SelectTrigger aria-label="关联 Feature"><SelectValue placeholder="选择 Feature" /></SelectTrigger><SelectContent>{available.map((candidate) => <SelectItem key={candidate.path} value={candidate.path}>{candidate.metadata.title} · {candidate.metadata.id}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={busy || !feature} onClick={() => fire(linkFeature())}><Link2 /> 关联 Feature</Button></div> : <p className="muted">{features.length === 0 ? "项目中还没有 Feature。" : "已关联所有可用 Feature。"}</p>}{error && <div className="form-error" role="alert">{error}</div>}</CardContent></Card>
}

export function FeedbackDetailPage() {
  const { id = "" } = useParams(); const { snapshot } = useWorkspace()
  const item = snapshot.feedback.find((candidate) => candidate.document.metadata.id === id)
  if (!item) return <Empty title="找不到反馈">它可能已被移动、删除或尚未导入。</Empty>
  return <><Link className="back-link" to="/feedback">返回反馈列表</Link><DocumentDetailPage kind="issue" /><div className="section-heading feedback-local-heading"><div><div className="eyebrow">来源与关联</div><h2>远端摘录与处理关系</h2><p>来源内容只读；本地未保存正文保持在上方编辑器中，不会因查看这些信息而被替换。</p></div></div><div className="feedback-detail-context"><SourcePanel item={item} /><FeatureLinker item={item} /></div></>
}
