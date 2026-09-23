// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { Plus, Trash2 } from "lucide-react"
import * as React from "react"
import { Schema } from "effect"
import type { FeedbackConnection } from "../../src/feedback-schema"
import { ContentSection, PanelEmpty, RecordDetails, RecordItem, RecordList } from "@/components/content-layout"
import { Field } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { dateTime, feedbackProviderLabel } from "@/lib/utils"
import { useWorkspace } from "@/workspace"

type GitHubConnection = Extract<FeedbackConnection, { readonly provider: "github" }>
type GitHubTransport = "api" | "gh"
const CheckResultSchema = Schema.Struct({
  connectionId: Schema.String,
  provider: Schema.Literal("github"),
  transport: Schema.Literal("gh"),
  target: Schema.String,
  checkedAt: Schema.String,
})

export function connectionSummary(connection: FeedbackConnection): string {
  return connection.provider === "github" ? `${connection.owner}/${connection.repo}` : connection.team
}

function connectionBinding(connection: FeedbackConnection): string {
  if (connection.provider === "github") return connection.repositoryId ? `仓库 ID：${connection.repositoryId}` : "首次成功同步后绑定仓库"
  return connection.organizationId && connection.teamId ? `组织 ID：${connection.organizationId} · 团队 ID：${connection.teamId}` : "首次成功同步后绑定组织和团队"
}

function transportOf(connection: GitHubConnection): GitHubTransport {
  return connection.transport === "gh" ? "gh" : "api"
}

function transportLabel(connection: FeedbackConnection): string {
  return connection.provider === "github" && transportOf(connection) === "gh" ? "gh 登录态" : "API 环境变量"
}

function connectionIdentity(connection: FeedbackConnection): string {
  return connection.provider === "github"
    ? JSON.stringify([connection.id, "github", transportOf(connection), connection.owner, connection.repo, connection.repositoryId ?? null, transportOf(connection) === "gh" ? null : connection.credentialEnv])
    : JSON.stringify([connection.id, "linear", connection.team, connection.organizationId ?? null, connection.teamId ?? null, connection.credentialEnv])
}

function githubConnection(connection: GitHubConnection, transport: GitHubTransport, credentialEnv: string): GitHubConnection {
  const common = { id: connection.id, provider: "github" as const, owner: connection.owner, repo: connection.repo, ...(connection.repositoryId ? { repositoryId: connection.repositoryId } : {}) }
  return transport === "gh" ? { ...common, transport: "gh" } : { ...common, credentialEnv }
}

export function FeedbackConnectionsEditor({ connections, onChange, prepareCheck }: {
  connections: readonly FeedbackConnection[]
  onChange(connections: readonly FeedbackConnection[]): void
  prepareCheck(connection: GitHubConnection): Promise<void>
}) {
  return <ContentSection title="已配置来源" summary={`${connections.length} 个连接`}>
    {connections.length === 0 ? <PanelEmpty title="尚未配置反馈来源">添加连接后，可在反馈页手动同步或导入。</PanelEmpty> : <RecordList>{connections.map((connection) => <ConnectionRow key={connection.id} connection={connection} onRemove={() => onChange(connections.filter((item) => item.id !== connection.id))} onReplace={(next) => onChange(connections.map((item) => item.id === connection.id ? next : item))} prepareCheck={prepareCheck} />)}</RecordList>}
    <AddConnection connections={connections} onChange={onChange} />
  </ContentSection>
}

function ConnectionRow({ connection, onRemove, onReplace, prepareCheck }: {
  connection: FeedbackConnection
  onRemove(): void
  onReplace(next: FeedbackConnection): void
  prepareCheck(connection: GitHubConnection): Promise<void>
}) {
  const { api } = useWorkspace()
  const [checking, setChecking] = React.useState(false)
  const [result, setResult] = React.useState("")
  const [error, setError] = React.useState("")
  const active = React.useRef<AbortController | null>(null)
  const generation = React.useRef(0)
  const identity = connectionIdentity(connection)
  React.useLayoutEffect(() => {
    setChecking(false); setResult(""); setError("")
    return () => { generation.current += 1; active.current?.abort() }
  }, [identity])

  async function check(): Promise<void> {
    if (connection.provider !== "github" || transportOf(connection) !== "gh") return
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    const ticket = ++generation.current
    setChecking(true); setResult(""); setError("")
    try {
      await prepareCheck(connection)
      if (controller.signal.aborted || generation.current !== ticket) return
      const response = await api.action({ action: "feedback.check", connection: connection.id }, controller.signal)
      if (controller.signal.aborted || generation.current !== ticket) return
      const checked = Schema.decodeUnknownSync(CheckResultSchema, { onExcessProperty: "error" })(response)
      if (checked.connectionId !== connection.id || checked.target !== connectionSummary(connection)) throw new Error("检测结果与当前连接不一致。")
      setResult(`连接正常 · ${checked.target} · ${dateTime(checked.checkedAt)}`)
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === ticket) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation.current === ticket) { setChecking(false); active.current = null }
    }
  }

  function invalidate(): void {
    generation.current += 1
    active.current?.abort()
    active.current = null
    setChecking(false); setResult(""); setError("")
  }

  return <RecordItem>
    <div className="card-title-row feedback-connection-row"><div><strong>{connectionSummary(connection)}</strong><div className="feedback-connection-meta"><Badge variant="outline">{feedbackProviderLabel(connection.provider)}</Badge><span>{transportLabel(connection)}</span><span>{connection.id}</span></div></div><div className="button-row">{connection.provider === "github" && <EditGitHubConnection connection={connection} onSubmit={(next) => { invalidate(); onReplace(next) }} />}{connection.provider === "github" && transportOf(connection) === "gh" && <Button type="button" size="sm" variant="outline" disabled={checking} onClick={() => { void check() }}>{checking ? "检测中…" : "检测连接"}</Button>}<Button type="button" size="icon-sm" variant="ghost" aria-label={`移除连接 ${connection.id}`} title="移除连接" onClick={() => { invalidate(); onRemove() }}><Trash2 /></Button></div></div>
    {result && <small role="status">{result}</small>}{error && <small className="feedback-source-status__error" role="alert">{error}</small>}
    <RecordDetails title="连接与绑定详情"><dl><dt>读取方式</dt><dd>{transportLabel(connection)}</dd><dt>读取目标</dt><dd>{connectionSummary(connection)}</dd>{connection.provider === "github" && transportOf(connection) === "gh" ? <><dt>运行账号</dt><dd>使用运行 Concord 的机器上的 gh 登录态。</dd></> : <><dt>凭据环境变量</dt><dd><code>{connection.credentialEnv}</code></dd></>}<dt>绑定状态</dt><dd>{connectionBinding(connection)}</dd></dl></RecordDetails>
  </RecordItem>
}

function TransportField({ value, onChange }: { value: GitHubTransport; onChange(value: GitHubTransport): void }) {
  return <Field label="读取方式"><Select value={value} onValueChange={(next) => onChange(next === "gh" ? "gh" : "api")}><SelectTrigger aria-label="GitHub 读取方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="api">API 环境变量</SelectItem><SelectItem value="gh">复用 gh 登录</SelectItem></SelectContent></Select></Field>
}

function EditGitHubConnection({ connection, onSubmit }: { connection: GitHubConnection; onSubmit(next: GitHubConnection): void }) {
  const [open, setOpen] = React.useState(false)
  const [transport, setTransport] = React.useState<GitHubTransport>(transportOf(connection))
  const [credentialEnv, setCredentialEnv] = React.useState(connection.transport === "gh" ? "" : connection.credentialEnv)
  function submit(event: React.FormEvent): void {
    event.preventDefault()
    onSubmit(githubConnection(connection, transport, credentialEnv))
    setOpen(false)
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { setTransport(transportOf(connection)); setCredentialEnv(connection.transport === "gh" ? "" : connection.credentialEnv) } }}><DialogTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={`编辑连接 ${connection.id}`}>编辑方式</Button></DialogTrigger><DialogContent><form onSubmit={submit}><DialogHeader><DialogTitle>编辑 GitHub 读取方式</DialogTitle><DialogDescription>{connectionSummary(connection)} · {connection.id}。切换方式保留仓库绑定。</DialogDescription></DialogHeader><div className="form-grid"><TransportField value={transport} onChange={setTransport} />{transport === "api" ? <Field label="凭据环境变量" hint="填写变量名，不填写 token 值。"><Input aria-label="凭据环境变量" value={credentialEnv} onChange={(event) => setCredentialEnv(event.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]*" required /></Field> : <p className="muted">使用运行 Concord 的机器上的 gh 登录态。</p>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit">保存方式</Button></DialogFooter></form></DialogContent></Dialog>
}

function AddConnection({ connections, onChange }: { connections: readonly FeedbackConnection[]; onChange(connections: readonly FeedbackConnection[]): void }) {
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState("")
  const [provider, setProvider] = React.useState<FeedbackConnection["provider"]>("github")
  const [transport, setTransport] = React.useState<GitHubTransport>("api")
  const [credentialEnv, setCredentialEnv] = React.useState("")
  const [owner, setOwner] = React.useState("")
  const [repo, setRepo] = React.useState("")
  const [team, setTeam] = React.useState("")
  const [error, setError] = React.useState("")
  function submit(event: React.FormEvent): void {
    event.preventDefault()
    if (connections.some((item) => item.id === id)) { setError("连接 ID 已存在。"); return }
    const connection: FeedbackConnection = provider === "github" ? transport === "gh" ? { id, provider, transport: "gh", owner, repo } : { id, provider, credentialEnv, owner, repo } : { id, provider, credentialEnv, team }
    onChange([...connections, connection])
    setOpen(false); setError(""); setId(""); setProvider("github"); setTransport("api"); setCredentialEnv(""); setOwner(""); setRepo(""); setTeam("")
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" size="sm" variant="outline"><Plus /> 添加连接</Button></DialogTrigger><DialogContent><form onSubmit={submit}><DialogHeader><DialogTitle>添加反馈来源</DialogTitle><DialogDescription>选择读取范围与方式。这里只填写凭据变量名，不填写密钥值。</DialogDescription></DialogHeader><div className="form-grid"><Field label="连接 ID" hint="小写字母、数字和单连字符"><Input aria-label="连接 ID" value={id} onChange={(event) => setId(event.target.value)} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></Field><Field label="来源"><Select value={provider} onValueChange={(value) => setProvider(value === "linear" ? "linear" : "github")}><SelectTrigger aria-label="连接来源"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="github">GitHub</SelectItem><SelectItem value="linear">Linear</SelectItem></SelectContent></Select></Field>{provider === "github" && <TransportField value={transport} onChange={setTransport} />}{(provider === "linear" || transport === "api") ? <Field label="凭据环境变量" hint={provider === "linear" ? "Linear 个人 API key 的变量名，例如 LINEAR_API_KEY。" : "GitHub token 的变量名，例如 GITHUB_TOKEN。"}><Input aria-label="凭据环境变量" value={credentialEnv} onChange={(event) => setCredentialEnv(event.target.value)} pattern="[A-Za-z_][A-Za-z0-9_]*" required /></Field> : <p className="muted">使用运行 Concord 的机器上的 gh 登录态。</p>}{provider === "github" ? <div className="two-column"><Field label="Owner"><Input aria-label="GitHub owner" value={owner} onChange={(event) => setOwner(event.target.value)} required /></Field><Field label="Repository"><Input aria-label="GitHub repository" value={repo} onChange={(event) => setRepo(event.target.value)} required /></Field></div> : <Field label="Team" hint="首次成功同步后绑定团队 ID。"><Input aria-label="Linear team" value={team} onChange={(event) => setTeam(event.target.value)} required /></Field>}{error && <div className="form-error" role="alert">{error}</div>}</div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit">添加</Button></DialogFooter></form></DialogContent></Dialog>
}
