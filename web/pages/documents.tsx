// @concord-file web-workbench-documents
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  FilePlus2,
  Folder,
  GitBranch,
  Link2,
  Plus,
  Save,
} from "lucide-react"
import * as stylex from "@stylexjs/stylex"
import * as React from "react"
import { Link, Navigate, Outlet, useNavigate, useParams, useSearchParams } from "react-router-dom"

import type { DocumentKind, DocumentRecord } from "../../src/shared"
import type { ViewAction, ViewFile } from "../../src/view-contract"
import { TEMPLATE_PAGES, PAGE_DESCRIPTIONS, type TemplatePage } from "../../src/template-pages"
import { MarkdownEditor } from "@/components/markdown-editor"
import { useDraftNavigation } from "@/components/draft-navigation"
import { Definition, Empty, Field, PageHeader } from "@/components/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAutoSave } from "@/hooks/use-auto-save"
import { DetailDrawer } from "@/components/detail-drawer"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { humanKind } from "@/lib/utils"
import { useWorkspace } from "@/workspace"

import { contractIdentities, ImplementationPanel, TestingPanel } from './operations'

const descriptions: Record<string, string> = {
  feature: "当前交付目标；Use Case 只在所属 Feature 内维护。",
  engineering: "测试、构建与维护机制的工程契约。",
  roadmap: "尚未采用的方向与演进计划。",
  design: "备选方案、约束和已作出的技术裁决。",
  research: "带来源和观察日期的决策输入。",
  memory: "Problem、Decision 与 Insight 的工程记忆。",
  issue: "仅本地的观察草稿，不代表远端 Issue 状态。",
}

const documentStyles = stylex.create({
  detailHost: { display: "flex", flex: 1, minHeight: 0 },
  detailRoot: { display: "flex", flex: { default: 1, "@media (max-width: 760px)": "none" }, flexDirection: "column", minHeight: 0, overflow: { default: "hidden", "@media (max-width: 760px)": "visible" } },
  tabsHeader: {
    position: "sticky",
    zIndex: 12,
    top: 0,
    display: "flex",
    alignItems: { default: "center", "@media (max-width: 760px)": "stretch" },
    flexDirection: { default: "row", "@media (max-width: 760px)": "column" },
    justifyContent: "space-between",
    gap: 16,
    marginInline: -4,
    marginBottom: 16,
    padding: 4,
    backgroundColor: "var(--background)",
  },
  tabsList: { minWidth: 0, overflowX: "auto", scrollbarWidth: "none" },
  fileLayout: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(210px, 260px) minmax(0, 1fr)", "@media (max-width: 760px)": "1fr" },
    alignItems: "stretch",
    gap: 16,
    height: { default: "100%", "@media (max-width: 760px)": "auto" },
    minHeight: 0,
  },
  singleFileLayout: { gridTemplateColumns: "minmax(0, 1fr)" },
  tabPanel: { flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" },
  bodyPanel: { overflow: "hidden" },
  pathList: {
    position: "static",
    maxHeight: { default: "none", "@media (max-width: 760px)": 230 },
    overflowY: "auto",
    scrollbarWidth: "none",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--card)",
  },
  preview: { minWidth: 0, minHeight: 0, overflowY: { default: "auto", "@media (max-width: 760px)": "visible" }, overscrollBehavior: "contain", scrollbarWidth: "none" },
  tree: { display: "grid", gap: 1 },
  nested: { marginLeft: 10, paddingLeft: 7, borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: "var(--border)" },
  treeRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    width: "100%",
    minWidth: 0,
    minHeight: 34,
    paddingBlock: 6,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 7,
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": "var(--accent)" },
  },
  selectedTreeRow: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
  treeIcon: { width: 15, height: 15, flexShrink: 0, color: "var(--muted-foreground)" },
  chevron: { transition: "transform 120ms ease" },
  openChevron: { transform: "rotate(90deg)" },
  treeSpacer: { flexShrink: 0, width: 15 },
  treeName: { minWidth: 0, overflow: "hidden", fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  treeMetadata: { marginLeft: "auto", color: "var(--muted-foreground)", fontSize: 10 },
  skeleton: { minHeight: 520, padding: "48px clamp(28px, 7vw, 100px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: "var(--radius)", backgroundColor: "var(--card)" },
  skeletonTitle: { width: "58%", height: 48, marginBottom: 28, borderRadius: 8, backgroundColor: "var(--muted)", animationName: stylex.keyframes({ "0%, 100%": { opacity: .45 }, "50%": { opacity: .9 } }), animationDuration: "1.25s", animationIterationCount: "infinite" },
  skeletonLine: { height: 17, marginBottom: 14, borderRadius: 5, backgroundColor: "var(--muted)", animationName: stylex.keyframes({ "0%, 100%": { opacity: .4 }, "50%": { opacity: .78 } }), animationDuration: "1.25s", animationIterationCount: "infinite" },
  skeletonLineLong: { width: "100%" },
  skeletonLineMedium: { width: "82%" },
  skeletonLineShort: { width: "66%" },
})

function documentHref(document: DocumentRecord): string {
  const sections: Record<string, string> = {
    feature: "features",
    engineering: "engineering",
    roadmap: "roadmap",
    design: "design",
    research: "research",
    memory: "memory",
    issue: "issues",
  }
  return `/${sections[document.metadata.kind] ?? "features"}/${encodeURIComponent(document.metadata.id)}`
}

function featureMatches(reference: string, feature: DocumentRecord): boolean {
  return (
    reference === feature.path ||
    reference === feature.metadata.id ||
    reference.endsWith(`/${feature.metadata.id}/README.md`)
  )
}

function fire(task: Promise<unknown>): void {
  void task.catch(() => undefined)
}

function CreateDocument({
  kind,
  feature,
}: {
  kind: DocumentKind
  feature?: string
}) {
  const { act, busy } = useWorkspace()
  const [open, setOpen] = React.useState(false)
  const [id, setId] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [observedAt, setObservedAt] = React.useState(
    new Date().toISOString().slice(0, 10)
  )
  const [sources, setSources] = React.useState("")
  const [alternatives, setAlternatives] = React.useState("")
  const [pages, setPages] = React.useState<TemplatePage[]>([])
  const selectablePages = kind === "feature" || kind === "roadmap" || kind === "design"
  const [memoryKind, setMemoryKind] = React.useState<
    "problem" | "decision" | "insight"
  >("problem")

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const action: ViewAction = {
      action: "document.create",
      kind,
      id,
      title,
      ...(selectablePages ? { pages } : {}),
      ...(body ? { body } : {}),
      ...(feature ? { feature } : {}),
      ...(kind === "research"
        ? {
            observedAt,
            sources: sources
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(kind === "design"
        ? {
            alternatives: alternatives
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
      ...(kind === "memory" ? { memoryKind } : {}),
    }
    await act(action, `${humanKind(kind)} 已创建。`)
    setOpen(false)
    setId("")
    setTitle("")
    setBody("")
    setPages([])
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> 新建 {humanKind(kind)}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={(event) => fire(submit(event))}>
          <DialogHeader>
            <DialogTitle>新建 {humanKind(kind)}</DialogTitle>
            <DialogDescription>
              {kind === "use-case"
                ? "此 Use Case 会自动绑定当前 Feature，不能脱离 Feature 创建。"
                : descriptions[kind]}
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <Field label="ID" hint="小写字母、数字和单连字符">
              <Input
                aria-label={`${humanKind(kind)} ID`}
                value={id}
                onChange={(event) => setId(event.target.value)}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
              />
            </Field>
            <Field label="标题">
              <Input
                aria-label={`${humanKind(kind)} 标题`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            {kind === "memory" && (
              <Field label="记忆类型">
                <Select
                  value={memoryKind}
                  onValueChange={(value) =>
                    setMemoryKind(value as typeof memoryKind)
                  }
                >
                  <SelectTrigger aria-label="Memory 类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="problem">Problem</SelectItem>
                    <SelectItem value="decision">Decision</SelectItem>
                    <SelectItem value="insight">Insight</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {kind === "research" && (
              <>
                <Field label="观察日期">
                  <Input
                    aria-label="观察日期"
                    type="date"
                    value={observedAt}
                    onChange={(event) => setObservedAt(event.target.value)}
                    required
                  />
                </Field>
                <Field label="来源" hint="每行一个来源">
                  <Textarea
                    aria-label="Research 来源"
                    value={sources}
                    onChange={(event) => setSources(event.target.value)}
                    required
                  />
                </Field>
              </>
            )}
            {kind === "design" && (
              <Field label="备选方案" hint="用逗号分隔">
                <Input
                  aria-label="Design 备选方案"
                  value={alternatives}
                  onChange={(event) => setAlternatives(event.target.value)}
                  required
                />
              </Field>
            )}
            {selectablePages && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">页面模板</legend>
                <p className="text-sm text-muted-foreground">README 必需。其余按需选择，之后也可添加。{kind === "design" && "所选页面用于每个候选；决策外层文件始终创建。"}</p>
                {TEMPLATE_PAGES.map((page) => (
                  <label key={page} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" aria-label={PAGE_DESCRIPTIONS[page].label} checked={pages.includes(page)} onChange={(event) => setPages((current) => event.target.checked ? [...current, page] : current.filter((value) => value !== page))} />
                    <span>{PAGE_DESCRIPTIONS[page].label} — {PAGE_DESCRIPTIONS[page].purpose}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <Field label="初始正文" hint="留空时使用内置模板">
              <Textarea
                aria-label="初始正文"
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              创建
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DocumentsListPage({
  kind,
}: {
  kind: Exclude<DocumentKind, "use-case">
}) {
  const { snapshot, dirty } = useWorkspace()
  const [filter, setFilter] = React.useState("")
  const documents = snapshot.documents.filter(
    (document) =>
      document.metadata.kind === kind &&
      `${document.metadata.title} ${document.metadata.id}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase())
  )
  if (["feature", "engineering", "roadmap", "design", "research"].includes(kind)) {
    const first = snapshot.documents.find(document => document.metadata.kind === kind)
    if (first) return dirty ? null : <Navigate to={documentHref(first)} replace />
  }

  return (
    <>
      <PageHeader
        eyebrow="契约空间"
        title={humanKind(kind)}
        description={descriptions[kind]}
        actions={<CreateDocument kind={kind} />}
      />
      <div className="list-toolbar">
        <Input
          aria-label={`筛选 ${humanKind(kind)}`}
          placeholder="按标题或 ID 筛选…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <Badge variant="secondary">{documents.length} 项</Badge>
      </div>
      {documents.length === 0 ? (
        <Empty title={`还没有 ${humanKind(kind)}`}>从右上角创建第一项。</Empty>
      ) : (
        <div className="card-grid">
          {documents.map((document) => (
            <Link
              key={document.path}
              to={documentHref(document)}
              className="card-link"
            >
              <Card>
                <CardHeader>
                  <div className="card-title-row">
                    <CardTitle>{document.metadata.title}</CardTitle>
                    <Badge variant="outline">{document.metadata.id}</Badge>
                  </div>
                  <CardDescription>{document.path}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DocumentSummary document={document} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

function DocumentSummary({ document }: { document: DocumentRecord }) {
  const metadata = document.metadata
  if (metadata.kind === "roadmap") {
    return <Badge variant="secondary">{metadata.state}</Badge>
  }
  if (metadata.kind === "design") {
    return (
      <p>
        {metadata.decision
          ? `已选择 ${metadata.decision.selected}`
          : `${metadata.alternatives.length} 个备选方案`}
      </p>
    )
  }
  if (metadata.kind === "research") {
    return <p>{metadata.observedAt} · {metadata.sources.length} 个来源</p>
  }
  if (metadata.kind === "memory") {
    return (
      <div className="inline-badges">
        <Badge>{metadata.memoryKind}</Badge>
        <Badge variant="secondary">{metadata.state}</Badge>
      </div>
    )
  }
  if (metadata.kind === "issue") {
    return <Badge variant="outline">{metadata.state}</Badge>
  }
  return <p>{document.body.slice(0, 150) || "等待撰写"}</p>
}

export function FeatureDetailPage() {
  const { id = "", useCaseId } = useParams()
  const { snapshot } = useWorkspace()
  const feature = snapshot.documents.find(
    (document) =>
      document.metadata.kind === "feature" && document.metadata.id === id
  )
  if (!feature) {
    return <Empty title="找不到 Feature">它可能已被移动或删除。</Empty>
  }
  const useCases = snapshot.documents.filter(
    (document) =>
      document.metadata.kind === "use-case" &&
      featureMatches(document.metadata.feature, feature)
  )
  const nested = (
    <section className="feature-use-cases">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Feature 内部</div>
          <h2>Use Cases</h2>
          <p>用户路径属于此 Feature，不作为独立顶级入口。</p>
        </div>
        <CreateDocument kind="use-case" feature={feature.path} />
      </div>
      {useCases.length === 0 ? (
        <Empty title="还没有 Use Case">
          从这里创建时会自动绑定 {feature.metadata.title}。
        </Empty>
      ) : (
        <div className="compact-list">
          {useCases.map((item) => (
            <Link
              key={item.path}
              to={`/features/${encodeURIComponent(feature.metadata.id)}/use-cases/${encodeURIComponent(item.metadata.id)}`}
            >
              <div>
                <strong>{item.metadata.title}</strong>
                <span>{item.metadata.id}</span>
              </div>
              <ExternalLink size={16} />
            </Link>
          ))}
        </div>
      )}
    </section>
  )
  return <>
    <div inert={useCaseId !== undefined} {...stylex.props(documentStyles.detailHost)}>
      <DocumentLayout key={feature.path} document={feature} extra={nested} background={useCaseId !== undefined} />
    </div>
    <Outlet />
  </>
}

export function UseCaseDrawer() {
  const { id, useCaseId } = useParams()
  const { snapshot } = useWorkspace()
  const navigate = useNavigate()
  const feature = snapshot.documents.find(item => item.metadata.kind === "feature" && item.metadata.id === id)
  const document = snapshot.documents.find(item => item.metadata.kind === "use-case" && item.metadata.id === useCaseId && feature !== undefined && featureMatches(item.metadata.feature, feature))
  const close = () => navigate(`/features/${encodeURIComponent(id ?? "")}`, { replace: true })
  return <DetailDrawer open onClose={close} model={{
    title: document?.metadata.title ?? "找不到 Use Case",
    description: `所属 Feature：${feature?.metadata.title ?? id}`,
  }}>
    {document ? <DocumentLayout key={document.path} document={document} /> : <Empty title="找不到 Use Case">此 Feature 下没有该 Use Case。</Empty>}
  </DetailDrawer>
}

export function DocumentDetailPage({ kind }: { kind: DocumentKind }) {
  const params = useParams()
  const id = kind === "use-case" ? params.useCaseId : params.id
  const { snapshot } = useWorkspace()
  const document = snapshot.documents.find(
    (item) => item.metadata.kind === kind && item.metadata.id === id
  )
  if (!document) {
    return <Empty title={`找不到 ${humanKind(kind)}`}>它可能已被移动或删除。</Empty>
  }
  let back: React.ReactNode = null
  if (document.metadata.kind === "use-case") {
    const featureReference = document.metadata.feature
    const feature = snapshot.documents.find(
      (item) =>
        item.metadata.kind === "feature" &&
        featureMatches(featureReference, item)
    )
    back = (
      <Link
        className="back-link"
        to={feature ? `/features/${feature.metadata.id}` : "/features"}
      >
        <ArrowLeft /> 返回所属 Feature
      </Link>
    )
  }
  return <>{back}<DocumentLayout key={document.path} document={document} /></>
}

function DocumentLayout({
  document,
  extra,
  background = false,
}: {
  document: DocumentRecord
  extra?: React.ReactNode
  background?: boolean
}) {
  const { snapshot } = useWorkspace()
  const [params] = useSearchParams()
  const requestedTab = params.get("tab") === "pages" ? "body" : params.get("tab") ?? "body"
  const [tab, setTab] = React.useState(requestedTab)
  const [editorToolbar, setEditorToolbar] = React.useState<HTMLDivElement | null>(null)
  React.useEffect(() => { setTab(requestedTab) }, [requestedTab])
  const tabNavigation = useDraftNavigation(setTab)
  const pages = snapshot.pages.filter(
    (page) => page.documentPath === document.path && page.path !== document.path
  )

  return (
    <>
      <Tabs value={tab} onValueChange={value => { if (value !== tab) tabNavigation.request(value) }} {...stylex.props(documentStyles.detailRoot)}>
        <div data-testid="document-header" {...stylex.props(documentStyles.tabsHeader)}>
          <TabsList aria-label="文档详情" {...stylex.props(documentStyles.tabsList)}>
            <TabsTrigger value="body">正文</TabsTrigger>
            <TabsTrigger value="relations">关系</TabsTrigger>
            {["feature", "use-case"].includes(document.metadata.kind) && <><TabsTrigger value="implementation">实现</TabsTrigger><TabsTrigger value="testing">测试</TabsTrigger></>}
            <TabsTrigger value="metadata">元数据</TabsTrigger>
            <TabsTrigger value="actions">生命周期</TabsTrigger>
          </TabsList>
          {!background && <div className="button-row">
            {["feature", "engineering", "roadmap", "design", "research"].includes(document.metadata.kind) && <CreateDocument kind={document.metadata.kind} />}
            <Button asChild variant="outline" size="sm"><Link to={`/git?path=${encodeURIComponent(document.path)}`}><GitBranch /> 查看 Git 变更</Link></Button>
            <div ref={setEditorToolbar} className="document-editor-actions" />
          </div>}
        </div>
        {["feature", "use-case"].includes(document.metadata.kind) && <><TabsContent value="implementation" {...stylex.props(documentStyles.tabPanel)}><ImplementationPanel document={document} /></TabsContent><TabsContent value="testing" {...stylex.props(documentStyles.tabPanel)}><TestingPanel document={document} /></TabsContent></>}
        <TabsContent value="body" {...stylex.props(documentStyles.tabPanel, documentStyles.bodyPanel)}>
          <DocumentFiles document={document} pages={pages} extra={extra} toolbarTarget={editorToolbar} />
        </TabsContent>
        <TabsContent value="relations" {...stylex.props(documentStyles.tabPanel)}>
          <Relationships document={document} />
        </TabsContent>
        <TabsContent value="metadata" {...stylex.props(documentStyles.tabPanel)}>
          <MetadataForm key={document.path} document={document} />
        </TabsContent>
        <TabsContent value="actions" {...stylex.props(documentStyles.tabPanel)}>
          <Lifecycle document={document} />
        </TabsContent>
      </Tabs>
      {tabNavigation.dialog}
    </>
  )
}

function DocumentFiles({
  document,
  pages,
  extra,
  toolbarTarget,
}: {
  document: DocumentRecord
  pages: readonly ViewFile[]
  extra?: React.ReactNode
  toolbarTarget?: HTMLElement | null
}) {
  const { act, api } = useWorkspace()
  const [selectedPath, setSelectedPath] = React.useState(document.path)
  const pageNavigation = useDraftNavigation(setSelectedPath)
  const [selected, setSelected] = React.useState<ViewFile | null>(null)
  const previewRef = React.useRef<HTMLElement>(null)
  const [error, setError] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [page, setPage] = React.useState("")
  const [plan, setPlan] = React.useState("")
  React.useEffect(() => { setSelectedPath(document.path) }, [document.path])
  React.useEffect(() => {
    const controller = new AbortController()
    setSelected(null)
    setError("")
    void api.file(selectedPath, controller.signal).then((file) => {
      setSelected(file)
      previewRef.current?.scrollTo({ top: 0 })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [api, selectedPath])
  const files = [{ path: document.path, readOnly: false }, ...pages]
  const ownerDirectory = document.path.slice(0, document.path.lastIndexOf("/") + 1)
  const tree = React.useMemo(() => buildFileTree(files, ownerDirectory), [files, ownerDirectory])
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set(treeDirectoryPaths(tree)))
  React.useEffect(() => {
    const relative = selectedPath.startsWith(ownerDirectory) ? selectedPath.slice(ownerDirectory.length) : selectedPath
    const segments = relative.split("/")
    setExpanded((current) => {
      const next = new Set(current)
      for (let index = 1; index < segments.length; index += 1) next.add(segments.slice(0, index).join("/"))
      return next
    })
  }, [ownerDirectory, selectedPath])
  const allowed = ["feature", "roadmap", "design", "engineering"].includes(
    document.metadata.kind
  )
  const showPathList = allowed || pages.length > 0
  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!allowed) return
    await act(
      {
        action: "page.add",
        kind: document.metadata.kind as
          | "feature"
          | "roadmap"
          | "design"
          | "engineering",
        id: document.metadata.id,
        page,
        ...(plan ? { plan } : {}),
      },
      "支持页面已创建。"
    )
    setOpen(false)
    setPage("")
  }
  return (
    <div {...stylex.props(documentStyles.fileLayout, !showPathList && documentStyles.singleFileLayout)}>
      {showPathList && <aside data-testid="document-file-tree" {...stylex.props(documentStyles.pathList)}>
        <div className="section-heading section-heading--compact">
          <strong>文件</strong>
          {allowed && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <FilePlus2 /> 添加
            </Button>
          )}
        </div>
        <FileTree
          nodes={tree}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={(path) => setExpanded((current) => {
            const next = new Set(current)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
          })}
          onSelect={(path) => { if (path !== selectedPath) pageNavigation.request(path) }}
        />
      </aside>}
      <section ref={previewRef} data-testid="document-file-preview" {...stylex.props(documentStyles.preview)}>
        {error && <div className="form-error">{error}</div>}
        {selected ? (
          <><MarkdownEditor key={selected.path} initial={selected} onSaved={setSelected} toolbarTarget={toolbarTarget} />{selected.path === document.path && extra}</>
        ) : (
          !error && <DocumentSkeleton />
        )}
      </section>
      {pageNavigation.dialog}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(event) => fire(submit(event))}>
            <DialogHeader>
              <DialogTitle>添加支持页面</DialogTitle>
              <DialogDescription>
                页面属于当前文档，不会创建新的顶级契约。
              </DialogDescription>
            </DialogHeader>
            <div className="form-grid">
              <Field label="页面名称">
                <Input
                  aria-label="页面名称"
                  value={page}
                  onChange={(event) => setPage(event.target.value)}
                  required
                />
              </Field>
              {document.metadata.kind === "design" && (
                <Field label="所属方案（可选）">
                  <Input
                    aria-label="所属设计方案"
                    value={plan}
                    onChange={(event) => setPlan(event.target.value)}
                  />
                </Field>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">添加</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DocumentSkeleton() {
  return <div role="status" aria-label="正在载入文件" {...stylex.props(documentStyles.skeleton)}>
    <div {...stylex.props(documentStyles.skeletonTitle)} />
    <div {...stylex.props(documentStyles.skeletonLine, documentStyles.skeletonLineLong)} />
    <div {...stylex.props(documentStyles.skeletonLine, documentStyles.skeletonLineLong)} />
    <div {...stylex.props(documentStyles.skeletonLine, documentStyles.skeletonLineMedium)} />
    <div {...stylex.props(documentStyles.skeletonLine, documentStyles.skeletonLineLong)} />
    <div {...stylex.props(documentStyles.skeletonLine, documentStyles.skeletonLineShort)} />
  </div>
}

interface FileTreeNode {
  readonly name: string
  readonly relativePath: string
  readonly path?: string
  readonly readOnly?: boolean
  readonly children: readonly FileTreeNode[]
}

function buildFileTree(files: readonly { path: string; readOnly: boolean }[], ownerDirectory: string): readonly FileTreeNode[] {
  type MutableNode = { name: string; relativePath: string; path?: string; readOnly?: boolean; children: MutableNode[] }
  const root: MutableNode = { name: "", relativePath: "", children: [] }
  for (const file of files) {
    const relative = file.path.startsWith(ownerDirectory) ? file.path.slice(ownerDirectory.length) : file.path
    let parent = root
    for (const [index, name] of relative.split("/").entries()) {
      const relativePath = relative.split("/").slice(0, index + 1).join("/")
      let node = parent.children.find((item) => item.name === name)
      if (!node) {
        node = { name, relativePath, children: [] }
        parent.children.push(node)
      }
      if (index === relative.split("/").length - 1) {
        node.path = file.path
        node.readOnly = file.readOnly
      }
      parent = node
    }
  }
  const sort = (nodes: MutableNode[]): MutableNode[] => nodes
    .sort((left, right) => Number(right.children.length > 0) - Number(left.children.length > 0) || left.name.localeCompare(right.name))
    .map((node) => ({ ...node, children: sort(node.children) }))
  return sort(root.children)
}

function treeDirectoryPaths(nodes: readonly FileTreeNode[]): readonly string[] {
  return nodes.flatMap((node) => node.children.length > 0 ? [node.relativePath, ...treeDirectoryPaths(node.children)] : [])
}

function FileTree({ nodes, expanded, selectedPath, onToggle, onSelect, depth = 0 }: {
  nodes: readonly FileTreeNode[]
  expanded: ReadonlySet<string>
  selectedPath: string
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  depth?: number
}) {
  return <div {...stylex.props(documentStyles.tree, depth > 0 && documentStyles.nested)}>{nodes.map((node) => {
    const directory = node.children.length > 0
    const open = expanded.has(node.relativePath)
    return <React.Fragment key={node.relativePath}>
      <button
        type="button"
        data-active={node.path === selectedPath || undefined}
        aria-label={node.relativePath}
        aria-expanded={directory ? open : undefined}
        title={node.relativePath}
        {...stylex.props(documentStyles.treeRow, node.path === selectedPath && documentStyles.selectedTreeRow)}
        onClick={() => directory ? onToggle(node.relativePath) : node.path && onSelect(node.path)}
      >
        {directory ? <><ChevronRight {...stylex.props(documentStyles.treeIcon, documentStyles.chevron, open && documentStyles.openChevron)} /><Folder {...stylex.props(documentStyles.treeIcon)} /></> : <><span {...stylex.props(documentStyles.treeSpacer)} /><FileText {...stylex.props(documentStyles.treeIcon)} /></>}
        <span {...stylex.props(documentStyles.treeName)}>{node.name}</span>
        {node.readOnly && <small {...stylex.props(documentStyles.treeMetadata)}>只读</small>}
      </button>
      {directory && open && <FileTree nodes={node.children} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />}
    </React.Fragment>
  })}</div>
}

function Relationships({ document }: { document: DocumentRecord }) {
  const { snapshot } = useWorkspace()
  const identities = contractIdentities(snapshot, document)
  const edges = snapshot.edges.filter(edge => identities.has(edge.from) || identities.has(edge.to))
  const cases = snapshot.cases.filter(item => identities.has(item.contract.split('#')[0]!))
  const codes = snapshot.codes.filter((item) =>
    item.contracts.some(
      (contract) =>
        identities.has(contract.split('#')[0]!)
    )
  )
  return (
    <div className="three-column">
      <Card>
        <CardHeader><CardTitle>领域关系</CardTitle></CardHeader>
        <CardContent>
          {edges.length ? edges.map((edge, index) => (
            <div className="mini-record" key={`${edge.from}-${edge.to}-${index}`}>
              <code>{edge.from}</code><Badge variant="outline">{edge.relation}</Badge><code>{edge.to}</code>
            </div>
          )) : <p className="muted">没有派生关系。</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>测试声明</CardTitle></CardHeader>
        <CardContent>
          {cases.length ? cases.map((item) => (
            <div className="mini-record" key={item.id}>
              <strong>{item.name}</strong><span>{item.file}:{item.line}</span>
            </div>
          )) : <p className="muted">没有关联测试。</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>实现声明</CardTitle></CardHeader>
        <CardContent>
          {codes.length ? codes.map((item) => (
            <div className="mini-record" key={item.id}>
              <strong>{item.symbol ?? item.id}</strong><span>{item.file}:{item.line}–{item.endLine}</span>
            </div>
          )) : <p className="muted">没有关联实现。</p>}
        </CardContent>
      </Card>
    </div>
  )
}

function MetadataForm({ document }: { document: DocumentRecord }) {
  const { api, refresh, setDirty, notify } = useWorkspace()
  const [baseline, setBaseline] = React.useState(document)
  const [title, setTitle] = React.useState(document.metadata.title)
  const research = document.metadata.kind === "research" ? document.metadata : null
  const [observedAt, setObservedAt] = React.useState(research?.observedAt ?? "")
  const [sources, setSources] = React.useState(research?.sources.join("\n") ?? "")
  const dirty = title !== baseline.metadata.title ||
    (baseline.metadata.kind === "research" &&
      (observedAt !== baseline.metadata.observedAt ||
        sources !== baseline.metadata.sources.join("\n")))
  const revision = JSON.stringify([title, observedAt, sources])
  const currentRevision = React.useRef(revision)
  currentRevision.current = revision
  React.useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
  async function submit(): Promise<void> {
    const sent = revision
    try {
      await api.action({
        action: "document.metadata",
        reference: baseline.path,
        expectedDigest: baseline.digest,
        title,
        ...(baseline.metadata.kind === "research"
          ? {
              observedAt,
              sources: sources.split("\n").map((value) => value.trim()).filter(Boolean),
            }
          : {}),
      })
      await refresh()
      const latest = await api.workspace()
      const saved = latest.documents.find((item) => item.path === baseline.path)
      if (!saved) throw new Error("保存后无法重新读取文档。")
      setBaseline(saved)
      if (currentRevision.current === sent) {
      setTitle(saved.metadata.title)
      if (saved.metadata.kind === "research") {
        setObservedAt(saved.metadata.observedAt)
        setSources(saved.metadata.sources.join("\n"))
      }
      setDirty(false)
      }
    } catch (cause) {
      throw cause
    }
  }
  const autoSave = useAutoSave({ dirty, revision, save: submit })
  return (
    <Card className="narrow-card">
      <CardHeader>
        <CardTitle>作者可编辑字段</CardTitle>
        <CardDescription>身份、状态与历史由对应操作维护。</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="form-grid" onSubmit={event => { event.preventDefault(); void autoSave.flush().catch(() => undefined) }}>
          <Field label="标题">
            <Input aria-label="文档标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          {baseline.metadata.kind === "research" && (
            <>
              <Field label="观察日期"><Input aria-label="观察日期" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></Field>
              <Field label="来源"><Textarea aria-label="来源" value={sources} onChange={(event) => setSources(event.target.value)} /></Field>
            </>
          )}
          <span role="status">{autoSave.status}</span>
          {autoSave.error && <div className="form-error" role="alert">{autoSave.error}<Button type="submit" variant="outline">重试保存</Button></div>}
        </form>
      </CardContent>
    </Card>
  )
}

function Lifecycle({ document }: { document: DocumentRecord }) {
  const metadata = document.metadata
  const history = metadata.kind === "memory" || metadata.kind === "issue" ? metadata.history : []
  return (
    <div className="lifecycle-grid">
      <Card>
        <CardHeader><CardTitle>当前状态</CardTitle></CardHeader>
        <CardContent>
          <dl>
            <Definition label="类型">{humanKind(metadata.kind)}</Definition>
            <Definition label="ID"><code>{metadata.id}</code></Definition>
            <Definition label="创建于">{metadata.createdAt}</Definition>
            {"state" in metadata && <Definition label="状态">{String(metadata.state)}</Definition>}
          </dl>
        </CardContent>
      </Card>
      <LifecycleActions document={document} />
      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle>历史</CardTitle></CardHeader>
          <CardContent><div className="timeline">{history.map((entry, index) => (
            <div key={`${entry.at}-${index}`}><i /><strong>{entry.action}</strong><time>{entry.at}</time><p>{entry.reason}</p></div>
          ))}</div></CardContent>
        </Card>
      )}
    </div>
  )
}

function LifecycleActions({ document }: { document: DocumentRecord }) {
  const { act, snapshot } = useWorkspace()
  const metadata = document.metadata
  const [reason, setReason] = React.useState("")
  const [target, setTarget] = React.useState("")
  const [selected, setSelected] = React.useState("")
  const [red, setRed] = React.useState("")
  const [green, setGreen] = React.useState("")
  const [resolution, setResolution] = React.useState<
    "fixed" | "not-a-bug" | "wont-fix" | "external-fixed"
  >("fixed")
  function invoke(action: ViewAction, text: string): void {
    fire(act(action, text).then(() => setReason("")))
  }
  if (!["roadmap", "design", "memory", "issue"].includes(metadata.kind)) {
    return <Card><CardHeader><CardTitle>生命周期操作</CardTitle><CardDescription>此类型没有额外状态转换。</CardDescription></CardHeader></Card>
  }
  return (
    <Card>
      <CardHeader><CardTitle>生命周期操作</CardTitle><CardDescription>使用明确动作维护状态与历史。</CardDescription></CardHeader>
      <CardContent><div className="form-grid">
        {metadata.kind === "roadmap" && (
          <><Field label="采用为 Feature ID"><Input aria-label="采用为 Feature ID" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button onClick={() => invoke({ action: "roadmap.adopt", id: metadata.id, feature: target }, "Roadmap 已采用为 Feature。")}>采用 Roadmap</Button></>
        )}
        {metadata.kind === "design" && (
          <><Field label="选定方案"><Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="选定设计方案"><SelectValue placeholder="选择方案" /></SelectTrigger><SelectContent>{metadata.alternatives.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Field label="关联目标" hint="每行一个引用"><Textarea aria-label="设计关联目标" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Field label="裁决理由"><Textarea aria-label="设计裁决理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "design.decide", id: metadata.id, selected, targets: target.split("\n").filter(Boolean), reason }, "设计裁决已记录。")}>记录裁决</Button></>
        )}
        {metadata.kind === "memory" && (
          <>
            {metadata.state === "open" ? (
              <><Field label="关闭类型"><Select value={resolution} onValueChange={(value) => setResolution(value as typeof resolution)}><SelectTrigger aria-label="Memory 关闭类型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed（命令证据）</SelectItem><SelectItem value="not-a-bug">Not a bug</SelectItem><SelectItem value="wont-fix">Won&apos;t fix</SelectItem><SelectItem value="external-fixed">External fixed</SelectItem></SelectContent></Select></Field>{resolution === "fixed" && <div className="two-column"><Field label="Red evidence"><Input aria-label="Red evidence" value={red} onChange={(event) => setRed(event.target.value)} list="evidence-ids" /></Field><Field label="Green evidence"><Input aria-label="Green evidence" value={green} onChange={(event) => setGreen(event.target.value)} list="evidence-ids" /></Field></div>}<Field label="理由"><Textarea aria-label="Memory 关闭理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "memory.resolve", id: metadata.id, kind: resolution, reason, ...(resolution === "fixed" ? { red, green } : {}) }, "Memory 已关闭。")}>关闭 Memory</Button></>
            ) : (
              <><Field label="重开理由"><Textarea aria-label="Memory 重开理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button variant="outline" onClick={() => invoke({ action: "memory.reopen", id: metadata.id, reason }, "Memory 已重开。")}>重新打开</Button></>
            )}
            <Field label="目标或替代 Memory"><Input aria-label="Memory 目标" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
            <div className="button-row"><Button variant="outline" onClick={() => invoke({ action: "memory.promote", id: metadata.id, target }, "Memory 已提升。")}>提升到契约</Button><Button variant="outline" onClick={() => invoke({ action: "memory.supersede", id: metadata.id, replacement: target, reason }, "Memory 已被替代。")}>标记替代</Button><Button variant="outline" onClick={() => invoke({ action: "memory.retire", id: metadata.id, target, reason }, "关联已退役。")}>退役关联</Button></div>
            <datalist id="evidence-ids">{snapshot.evidenceIds.map((id) => <option key={id} value={id} />)}</datalist>
          </>
        )}
        {metadata.kind === "issue" && metadata.state === "draft" && (
          <><Field label="关联 Memory"><Input aria-label="关联 Memory" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button variant="outline" onClick={() => invoke({ action: "issue.link", id: metadata.id, memory: target }, "Issue 已关联 Memory。") }><Link2 /> 关联 Memory</Button><Field label="关闭理由"><Textarea aria-label="Issue 关闭理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "issue.close", id: metadata.id, reason }, "Issue 已关闭。")}>关闭草稿</Button></>
        )}
      </div></CardContent>
    </Card>
  )
}
