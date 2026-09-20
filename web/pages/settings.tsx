// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { AlertTriangle, RefreshCw, Save } from "lucide-react"
import * as React from "react"
import { flushSync } from "react-dom"
import { Schema } from "effect"
import { ProjectInputSchema } from "../../src/view-contract"

import type { ProjectConfig } from "../../src/shared"
import { urlChoice, useUrlNavigation } from "@/hooks/use-url-navigation"
import { useAutoSave } from "@/hooks/use-auto-save"
import { Empty, Field, PageHeader } from "@/components/page"
import { ContentSection, PanelHeader } from "@/components/content-layout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { json } from "@/lib/utils"
import { useWorkspace } from "@/workspace"

function lines(value: readonly string[]): string { return value.join("\n") }
function values(value: string): string[] { return value.split("\n").map((item) => item.trim()).filter(Boolean) }

export function SettingsPage() {
  const { snapshot } = useWorkspace()
  if (!snapshot.project) {
    const diagnostics = snapshot.diagnostics
    const missing = typeof diagnostics === "object" && diagnostics !== null && "error" in diagnostics && diagnostics.error === "ProjectNotFound"
    return missing ? <InitializeProject /> : <InvalidConfiguration />
  }
  return <ConfigurationEditor key={snapshot.project.projectId} initial={snapshot.project} digest={snapshot.configDigest ?? ""} />
}

function ConfigurationEditor({ initial, digest }: { initial: ProjectConfig; digest: string }) {
  const { api, refresh, notify } = useWorkspace()
  const [baseline, setBaseline] = React.useState({ config: initial, digest })
  const [draft, setDraft] = React.useState<ProjectConfig>(initial)
  const [source, setSource] = React.useState(json(initial))
  const [testRootsText, setTestRootsText] = React.useState(lines(initial.testRoots))
  const [sourceRootsText, setSourceRootsText] = React.useState(lines(initial.sourceRoots ?? []))
  const [sourceFilesText, setSourceFilesText] = React.useState(lines(initial.runner.sourceFiles))
  const [argvText, setArgvText] = React.useState(initial.runner.kind === "command" ? lines(initial.runner.argv) : "")
  const [timeoutText, setTimeoutText] = React.useState(String(initial.runner.timeoutMs))
  const { params, update } = useUrlNavigation()
  const tab = urlChoice(params.get("tab"), ["form", "advanced", "diagnostics"], "form")
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [reloadOpen, setReloadOpen] = React.useState(false)
  const latestDigest = useWorkspace().snapshot.configDigest
  const formDirty = testRootsText !== lines(baseline.config.testRoots) || sourceRootsText !== lines(baseline.config.sourceRoots ?? []) || sourceFilesText !== lines(baseline.config.runner.sourceFiles) || timeoutText !== String(baseline.config.runner.timeoutMs) || draft.runner.kind !== baseline.config.runner.kind || (draft.runner.kind === "command" && argvText !== (baseline.config.runner.kind === "command" ? lines(baseline.config.runner.argv) : ""))
  const dirty = formDirty || source !== json(baseline.config)
  const externallyChanged = latestDigest !== null && latestDigest !== baseline.digest



  function change(next: ProjectConfig): void {
    setDraft(next)
    setSource(json(next))
  }

  function sync(next: ProjectConfig): void {
    setDraft(next)
    setSource(json(next))
    setTestRootsText(lines(next.testRoots))
    setSourceRootsText(lines(next.sourceRoots ?? []))
    setSourceFilesText(lines(next.runner.sourceFiles))
    setArgvText(next.runner.kind === "command" ? lines(next.runner.argv) : "")
    setTimeoutText(String(next.runner.timeoutMs))
  }

  function formConfig(): ProjectConfig {
    const timeoutMs = Number(timeoutText)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error("请输入有效的超时时间。")
    if (draft.runner.kind === "command") {
      const argv = argvText.split("\n").filter((item) => item.length > 0)
      if (!argv[0]) throw new Error("自定义命令至少需要一个参数。")
      return { ...draft, testRoots: values(testRootsText), sourceRoots: values(sourceRootsText), runner: { kind: "command", argv: [argv[0], ...argv.slice(1)], sourceFiles: values(sourceFilesText), timeoutMs } }
    }
    return { ...draft, testRoots: values(testRootsText), sourceRoots: values(sourceRootsText), runner: { kind: "node-test", sourceFiles: values(sourceFilesText), timeoutMs } }
  }


  const revision = JSON.stringify([tab, draft, source, testRootsText, sourceRootsText, sourceFilesText, argvText, timeoutText])
  const currentRevision = React.useRef(revision)
  currentRevision.current = revision

  async function persist(config: ProjectConfig): Promise<void> {
    const sent = revision
    setSaving(true)
    setError("")
    try {
      await api.action({ action: "config.set", config, expectedDigest: baseline.digest })
      const latest = await api.workspace()
      if (!latest.project || !latest.configDigest) throw new Error("保存后无法读取项目配置。")
      const saved = { config: latest.project, digest: latest.configDigest }
      flushSync(() => {
        setBaseline(saved)
        if (currentRevision.current === sent) sync(saved.config)
      })
      await refresh().catch(() => undefined)

    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw cause
    } finally {
      setSaving(false)
    }
  }

  async function reload(): Promise<void> {
    try {
      const latest = await api.workspace()
      if (!latest.project || !latest.configDigest) throw new Error("当前配置无法读取。")
      setBaseline({ config: latest.project, digest: latest.configDigest })
      sync(latest.project)
      setError("")
      setReloadOpen(false)
      notify("已载入磁盘上的最新设置。", "info")
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : String(cause), "error")
    }
  }

  const autoSave = useAutoSave({
    dirty,
    revision,
    discard: () => { sync(baseline.config); setError("") },
    save: async () => {
      const config = tab === "advanced" ? Schema.decodeUnknownSync(ProjectInputSchema, { onExcessProperty: "error" })(JSON.parse(source)) : formConfig()
      await persist(config)
    },
  })

  const runner = draft.runner
  return (
    <>
      <PageHeader
        title="项目设置"
        description="修改保存前会检查磁盘版本，避免覆盖其他编辑。"
        actions={<Button variant="outline" onClick={() => dirty ? setReloadOpen(true) : void reload()}><RefreshCw /> 重新载入</Button>}
      />
      {externallyChanged && <div className="callout callout--warning"><AlertTriangle /><div><strong>磁盘设置已变化</strong><p>当前草稿没有被覆盖。保存会要求你先比较或重新载入。</p></div></div>}
      <Tabs value={tab} onValueChange={next => update({ tab: next })}>
        <TabsList><TabsTrigger value="form">常用设置</TabsTrigger><TabsTrigger value="advanced">高级 JSON</TabsTrigger><TabsTrigger value="diagnostics">诊断</TabsTrigger></TabsList>
        <TabsContent value="form">
          <div className="form-section">
            <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void autoSave.flush().catch(() => undefined) }}>
              <PanelHeader title="常用设置" actions={<span className="form-status" role="status">{autoSave.status}</span>} />
              <ContentSection title="项目身份"><Field label="Project ID" hint="项目身份不能在这里更改"><Input aria-label="Project ID" value={draft.projectId} readOnly /></Field></ContentSection>
              <ContentSection title="扫描目录"><div className="two-column">
                <Field label="测试目录" hint="每行一个"><Textarea aria-label="测试目录" value={testRootsText} onChange={(event) => setTestRootsText(event.target.value)} /></Field>
                <Field label="源码目录" hint="每行一个"><Textarea aria-label="源码目录" value={sourceRootsText} onChange={(event) => setSourceRootsText(event.target.value)} /></Field>
              </div></ContentSection>
              <ContentSection title="测试运行"><div className="form-grid"><Field label="运行方式"><Select value={runner.kind} onValueChange={(kind) => change({ ...draft, runner: kind === "node-test" ? { kind: "node-test", sourceFiles: values(sourceFilesText), timeoutMs: Number(timeoutText) } : { kind: "command", argv: ["node"], sourceFiles: values(sourceFilesText), timeoutMs: Number(timeoutText) } })}><SelectTrigger aria-label="运行方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="node-test">Node test</SelectItem><SelectItem value="command">自定义命令</SelectItem></SelectContent></Select></Field>
              {runner.kind === "command" && <Field label="命令参数" hint="每行一个参数，不经过 shell"><Textarea aria-label="命令参数" value={argvText} onChange={(event) => setArgvText(event.target.value)} /></Field>}
              <Field label="相关文件" hint="每行一个"><Textarea aria-label="运行相关文件" value={sourceFilesText} onChange={(event) => setSourceFilesText(event.target.value)} /></Field>
              <Field label="超时（毫秒）"><Input aria-label="运行超时" type="number" min="1" max="3600000" value={timeoutText} onChange={(event) => setTimeoutText(event.target.value)} /></Field></div></ContentSection>
              {error && <div className="form-error" role="alert">{error}</div>}
              {autoSave.error && <div className="form-error" role="alert">{autoSave.error}<Button type="submit" variant="outline">重试保存</Button></div>}
            </form>
          </div>
        </TabsContent>
        <TabsContent value="advanced">
          <PanelHeader title="高级配置" actions={<span className="form-status" role="status">{autoSave.status}</span>} /><div><Textarea className="json-editor" aria-label="高级项目配置 JSON" value={source} onChange={(event) => setSource(event.target.value)} />{error && <div className="form-error" role="alert">{error}</div>}{autoSave.error && <div className="form-error" role="alert">{autoSave.error}<Button variant="outline" onClick={() => { void autoSave.flush().catch(() => undefined) }}>重试保存</Button></div>}</div>
        </TabsContent>
        <TabsContent value="diagnostics"><PanelHeader title="当前诊断" /><pre>{json(useWorkspace().snapshot.diagnostics)}</pre></TabsContent>
      </Tabs>
      <Dialog open={reloadOpen} onOpenChange={setReloadOpen}><DialogContent><DialogHeader><DialogTitle>丢弃未保存的设置？</DialogTitle><DialogDescription>重新载入会用磁盘版本替换当前草稿。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setReloadOpen(false)}>继续编辑</Button><Button variant="destructive" onClick={() => void reload()}>丢弃并载入</Button></DialogFooter></DialogContent></Dialog>
    </>
  )
}

function InvalidConfiguration() {
  const { snapshot, refresh, notify } = useWorkspace()
  const file = snapshot.pages.find(page => page.path === "concord.config.ts")
  return <><PageHeader title="项目配置无法读取" actions={<Button variant="outline" onClick={() => { void refresh().catch(cause => notify(cause instanceof Error ? cause.message : String(cause), "error")) }}><RefreshCw />重新载入</Button>} /><div className="callout callout--warning"><AlertTriangle /><div><strong>请检查 concord.config.ts 和下方诊断</strong><p>请在本地修复配置；需要迁移时遵循诊断指引。此页不修改原文件。</p></div></div><ContentSection title="诊断"><pre>{json(snapshot.diagnostics)}</pre></ContentSection><ContentSection title="原始配置">{file ? <Textarea className="json-editor" aria-label="无效配置原文" value={file.body} readOnly /> : <Empty title="无法安全读取配置原文">请根据诊断检查文件路径、大小或迁移状态。</Empty>}</ContentSection></>
}

function InitializeProject() {
  const { act } = useWorkspace()
  const [testRoots, setTestRoots] = React.useState("test")
  const [sourceRoots, setSourceRoots] = React.useState("src")
  const [docsOnly, setDocsOnly] = React.useState(false)
  function submit(event: React.FormEvent): void { event.preventDefault(); void act({ action: "init", ...(docsOnly ? { docsOnly: true } : { testRoots: values(testRoots) }), sourceRoots: values(sourceRoots) }, "项目已初始化。").catch(() => undefined) }
  return <><PageHeader title="初始化 Concord" description="当前 Git 仓库还没有 Concord 项目配置。" /><Card className="narrow-card"><CardContent><form className="form-grid" onSubmit={submit}><label className="checkbox-row"><input type="checkbox" checked={docsOnly} onChange={(event) => setDocsOnly(event.target.checked)} />纯文档仓库</label>{!docsOnly && <Field label="测试目录" hint="每行一个"><Textarea aria-label="初始化测试目录" value={testRoots} onChange={(event) => setTestRoots(event.target.value)} /></Field>}<Field label="源码目录" hint="每行一个"><Textarea aria-label="初始化源码目录" value={sourceRoots} onChange={(event) => setSourceRoots(event.target.value)} /></Field><Button type="submit">初始化</Button></form></CardContent></Card></>
}
