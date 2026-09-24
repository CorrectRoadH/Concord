// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { DOCUMENT_NAME_PATTERN } from "../../src/document-name"
import { matchingOwners } from '../../src/document-layout'
import { documentHref } from '../lib/document-routing'
export { documentHref } from '../lib/document-routing'
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
  RefreshCw,
  Save,
} from "lucide-react"
import * as stylex from "@stylexjs/stylex"
import * as React from "react"
import { createPortal } from "react-dom"
import { Link, Navigate, Outlet, useNavigate, useParams } from "react-router-dom"

import type { DocumentKind, DocumentRecord } from "../../src/shared"
import type { ViewAction, ViewFile } from "../../src/view-contract"
import { TEMPLATE_PAGES, PAGE_DESCRIPTIONS, type TemplatePage } from "../../src/template-pages"
import { MarkdownEditor } from "@/components/markdown-editor"
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
import { urlChoice, useUrlNavigation } from "@/hooks/use-url-navigation"
import { flushSync } from "react-dom"
import { DetailDrawer } from "@/components/detail-drawer"
import { TerminologyPanel } from "@/components/terminology-panel"
import { ContentSection, PanelHeader, PanelEmpty, RecordList, RecordItem, RecordLink } from "@/components/content-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { humanKind } from "@/lib/utils"
import { researchTopicDirectory } from "@/lib/research-topics"
import { useWorkspace } from "@/workspace"

import { contractIdentities, ImplementationPanel, TestingPanel } from './operations'

const descriptions: Record<string, string> = {
  feature: "当前交付目标；Use Case 只在所属 Feature 内维护。",
  engineering: "测试、构建与维护机制的工程契约。",
  roadmap: "尚未采用的方向与演进计划。",
  design: "备选方案、约束和已作出的技术裁决。",
  research: "按主题目录自由组织研究正文与资料。",
  memory: "Problem、Decision 与 Insight 的工程记忆。",
  issue: "仅本地的观察草稿，不代表远端 Issue 状态。",
}

const documentStyles = stylex.create({
  detailHost: { display: "flex", flexDirection: "column", flex: "none", minHeight: 0 },
  detailRoot: { display: "flex", flex: "none", flexDirection: "column", minHeight: 0 },
  tabsHeader: {
    position: "sticky",
    zIndex: 12,
    top: { default: "calc(-1 * var(--page-padding, 0px))", "@media (max-width: 767px)": 0 },
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
    alignItems: "start",
    gap: 16,
    // Keep the sticky tree supported even when the next file is short.
    minHeight: { default: "calc(100svh - 76px)", "@media (max-width: 760px)": 0 },
  },
  singleFileLayout: { gridTemplateColumns: "minmax(0, 1fr)" },
  tabPanel: { flex: "none", minHeight: 0 },
  bodyPanel: { overflow: "visible" },
  pathList: {
    position: { default: "sticky", "@media (max-width: 760px)": "static" },
    top: 68,
    maxHeight: { default: "calc(100svh - 180px)", "@media (max-width: 760px)": 230 },
    overflowY: "auto",
    scrollbarWidth: "none",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--card)",
  },
  preview: { minWidth: 0, minHeight: 0 },
  tree: { display: "grid", gap: 1 },
  nested: { marginLeft: 10, paddingLeft: 7, borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: "var(--border)" },
  treeRow: {
    display: "grid",
    gridTemplateColumns: "15px 15px minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 7,
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

export function relativeMarkdownTarget(currentPath: string, href: string): { path: string; hash: string } | undefined {
  if (!href || href.startsWith("#") || href.startsWith("/") || /^[a-z][a-z\d+.-]*:/iu.test(href)) return undefined
  try {
    const base = new URL(`https://concord.invalid/${currentPath}`)
    const resolved = new URL(href, base)
    if (resolved.origin !== base.origin) return undefined
    let path = decodeURIComponent(resolved.pathname).replace(/^\/+/, "")
    if (resolved.pathname.endsWith("/")) path += "README.md"
    if (!path.endsWith(".md")) return undefined
    return { path, hash: resolved.hash }
  } catch {
    return undefined
  }
}

function featureMatches(reference: string, feature: DocumentRecord): boolean {
  return (
    reference === feature.path ||
    reference === feature.metadata.id
  )
}

function fire(task: Promise<unknown>): void {
  void task.catch(() => undefined)
}

export function CreateDocument({
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
  const [observedAt, setObservedAt] = React.useState("")
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
            ...(observedAt.trim() ? { observedAt: observedAt.trim() } : {}),
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
        <Button variant={kind === "use-case" ? "outline" : "default"}>
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
            <Field label="ID" hint="中文等 Unicode 字母、数字，可用单连字符分隔">
              <Input
                aria-label={`${humanKind(kind)} ID`}
                value={id}
                onChange={(event) => setId(event.target.value)}
                pattern={DOCUMENT_NAME_PATTERN.source}
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
                <Field label="观察日期（可选）">
                  <Input
                    aria-label="观察日期"
                    type="date"
                    value={observedAt}
                    onChange={(event) => setObservedAt(event.target.value)}
                  />
                </Field>
                <Field label="来源（可选）" hint="每行一个来源">
                  <Textarea
                    aria-label="Research 来源"
                    value={sources}
                    onChange={(event) => setSources(event.target.value)}
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
  if (["feature", "engineering", "roadmap", "design", "research", "memory"].includes(kind)) {
    const first = snapshot.documents.find(document => document.metadata.kind === kind)
    if (first) return dirty ? null : <Navigate to={documentHref(first, snapshot.documents)} replace />
  }

  return (
    <>
      <PageHeader
        title={humanKind(kind)}
        description={descriptions[kind]}
        actions={!["feature", "engineering", "roadmap", "design", "research", "memory"].includes(kind) ? <CreateDocument kind={kind} /> : undefined}
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
        <Empty kind={filter ? "filtered" : "empty"} title={filter ? "没有匹配的文档" : `还没有 ${humanKind(kind)}`}>{filter ? "调整筛选条件后重试。" : "使用新建入口创建第一项。"}</Empty>
      ) : (
        <RecordList>
          {documents.map((document) => (
            <RecordItem key={document.path}>
            <Link
              to={documentHref(document, snapshot.documents)}
              className="block"
            >
                  <div className="card-title-row">
                    <strong>{document.metadata.title}</strong>
                    <Badge variant="outline">{document.metadata.id}</Badge>
                  </div>
                  <p className="muted break-all">{document.path}</p>
                  <DocumentSummary document={document} />
            </Link>
            </RecordItem>
          ))}
        </RecordList>
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
          : metadata.deferral ? "已暂缓" : `${metadata.alternatives.length} 个备选方案`}
      </p>
    )
  }
  if (metadata.kind === "research") {
    return <p>{[metadata.observedAt, metadata.sources.length ? `${metadata.sources.length} 个来源` : undefined].filter(Boolean).join(" · ")}</p>
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
  const navigation = useUrlNavigation()
  const { id = "", useCaseId } = useParams()
  const { snapshot } = useWorkspace()
  const feature = snapshot.documents.find(
    (document) =>
      document.metadata.kind === "feature" && document.metadata.id === id
  )
  if (!feature) {
    return <Empty kind="missing" title="找不到 Feature">它可能已被移动或删除。</Empty>
  }
  const useCases = snapshot.documents.filter(
    (document) =>
      document.metadata.kind === "use-case" &&
      featureMatches(document.metadata.feature, feature)
  )
  const nested = (
    <section className="feature-use-cases">
      <PanelHeader title="Use Cases" actions={<CreateDocument kind="use-case" feature={feature.path} />} />
      {useCases.length === 0 ? (
        <PanelEmpty title="还没有 Use Case">
          从这里创建时会自动绑定 {feature.metadata.title}。
        </PanelEmpty>
      ) : (
        <RecordList>
          {useCases.map((item) => (
            <RecordLink key={item.path}
              to={`/features/${encodeURIComponent(feature.metadata.id)}/use-cases/${encodeURIComponent(item.metadata.id)}`}
              state={navigation.opening(`/features/${encodeURIComponent(feature.metadata.id)}/use-cases/${encodeURIComponent(item.metadata.id)}`)}
            >
              <div>
                <strong>{item.metadata.title}</strong>
                <span className="block text-sm text-muted-foreground">{item.metadata.id}</span>
              </div>
              <ExternalLink size={16} />
            </RecordLink>
          ))}
        </RecordList>
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
  const navigation = useUrlNavigation()
  const { id, useCaseId } = useParams()
  const { snapshot } = useWorkspace()
  const navigate = useNavigate()
  const feature = snapshot.documents.find(item => item.metadata.kind === "feature" && item.metadata.id === id)
  const document = snapshot.documents.find(item => item.metadata.kind === "use-case" && item.metadata.id === useCaseId && feature !== undefined && featureMatches(item.metadata.feature, feature))
  const close = () => navigation.close(`/features/${encodeURIComponent(id ?? "")}?tab=use-cases`)
  return <DetailDrawer open onClose={close} model={{
    title: document?.metadata.title ?? "找不到 Use Case",
    description: `所属 Feature：${feature?.metadata.title ?? id}`,
  }}>
    {document ? <DocumentLayout key={document.path} document={document} /> : <Empty kind="missing" title="找不到 Use Case">此 Feature 下没有该 Use Case。</Empty>}
  </DetailDrawer>
}

export function DocumentDetailPage({ kind, relatedContent }: { kind: DocumentKind; relatedContent?: React.ReactNode }) {
  const params = useParams()
  const id = kind === "use-case" ? params.useCaseId : params.id
  const { snapshot } = useWorkspace()
  const matches = matchingOwners(snapshot.documents, id ?? '', kind)
  const document = matches.length === 1 ? matches[0] : undefined
  if (!document) {
    return <Empty kind="missing" title={`找不到 ${humanKind(kind)}`}>它可能已被移动或删除。</Empty>
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
  const layoutKey = kind === "research" ? researchTopicDirectory(document.path) : document.path
  return <>{back}<DocumentLayout key={layoutKey} document={document} relatedContent={relatedContent} /></>
}

function DocumentLayout({
  document,
  extra,
  relatedContent,
  background = false,
}: {
  document: DocumentRecord
  extra?: React.ReactNode
  relatedContent?: React.ReactNode
  background?: boolean
}) {
  const { snapshot } = useWorkspace()
  const { params, update } = useUrlNavigation()
  const showsLifecycle = ["roadmap", "design", "memory", "issue"].includes(document.metadata.kind)
  const requested = background && extra ? "use-cases" : params.get("tab") === "pages" ? "body" : params.get("tab") ?? "body"
  const requestedTab = requested === "actions" && !showsLifecycle ? "metadata" : requested
  const [editorToolbar, setEditorToolbar] = React.useState<HTMLDivElement | null>(null)
  const pages = snapshot.pages.filter(
    (page) => page.documentPath === document.path && page.path !== document.path
  )
  const showsTerminology = ["feature", "use-case", "roadmap", "design"].includes(document.metadata.kind)
  const showsImplementation = ["feature", "use-case", "engineering"].includes(document.metadata.kind)
  const showsTesting = ["feature", "use-case"].includes(document.metadata.kind)
  const availableTabs = ["body", "metadata", ...(extra ? ["use-cases"] : []), ...(showsTerminology ? ["terminology"] : []), ...(showsImplementation ? ["implementation"] : []), ...(showsTesting ? ["testing"] : []), ...(showsLifecycle ? ["actions"] : []), ...(relatedContent ? ["related"] : [])]
  const tab = urlChoice(requestedTab, availableTabs, "body")

  return (
    <>
      <Tabs value={tab} onValueChange={value => { if (value !== tab) update({ tab: value, source: null, sourceLine: null, sourceEndLine: null }) }} {...stylex.props(documentStyles.detailRoot)}>
        <div data-testid="document-header" {...stylex.props(documentStyles.tabsHeader)}>
          <TabsList aria-label="文档详情" {...stylex.props(documentStyles.tabsList)}>
            <TabsTrigger value="body">正文</TabsTrigger>
            {extra && <TabsTrigger value="use-cases">Use Cases</TabsTrigger>}
            {showsTerminology && <TabsTrigger value="terminology">术语</TabsTrigger>}
            {showsImplementation && <TabsTrigger value="implementation">实现</TabsTrigger>}
            {showsTesting && <TabsTrigger value="testing">测试</TabsTrigger>}
            <TabsTrigger value="metadata">元数据</TabsTrigger>
            {showsLifecycle && <TabsTrigger value="actions">生命周期</TabsTrigger>}
            {relatedContent && <TabsTrigger value="related">来源与关联</TabsTrigger>}
          </TabsList>
          {!background && <div className="button-row">
            <Button asChild variant="outline" size="sm"><Link to={`/git?path=${encodeURIComponent(document.path)}`}><GitBranch /> 查看 Git 变更</Link></Button>
            <div ref={setEditorToolbar} className="document-editor-actions" />
          </div>}
        </div>
        {showsTerminology && <TabsContent value="terminology" {...stylex.props(documentStyles.tabPanel)}><TerminologyPanel document={document} /></TabsContent>}
        {showsImplementation && <TabsContent value="implementation" {...stylex.props(documentStyles.tabPanel)}><ImplementationPanel document={document} /></TabsContent>}
        {showsTesting && <TabsContent value="testing" {...stylex.props(documentStyles.tabPanel)}><TestingPanel document={document} /></TabsContent>}
        <TabsContent value="body" {...stylex.props(documentStyles.tabPanel, documentStyles.bodyPanel)}>
          <DocumentFiles document={document} pages={pages} toolbarTarget={editorToolbar} />
        </TabsContent>
        {extra && <TabsContent value="use-cases" {...stylex.props(documentStyles.tabPanel)}>{extra}</TabsContent>}
        <TabsContent value="metadata" {...stylex.props(documentStyles.tabPanel)}>
          <MetadataForm key={document.path} document={document} />
        </TabsContent>
        {showsLifecycle && <TabsContent value="actions" {...stylex.props(documentStyles.tabPanel)}>
          <Lifecycle key={document.path} document={document} />
        </TabsContent>}
        {relatedContent && <TabsContent value="related" {...stylex.props(documentStyles.tabPanel)}>{relatedContent}</TabsContent>}
      </Tabs>
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
  const { act, api, snapshot } = useWorkspace()
  const navigate = useNavigate()
  const { params, update } = useUrlNavigation()
  const topicDirectory = document.metadata.kind === "research" ? researchTopicDirectory(document.path) : undefined
  const topicDocuments = topicDirectory ? snapshot.documents.filter(item => item.metadata.kind === "research" && item.path.startsWith(topicDirectory)) : []
  const topicPages = topicDirectory ? snapshot.pages.filter(item => item.path.startsWith(topicDirectory)) : pages
  const files = [...new Map([{ path: document.path, readOnly: false }, ...topicDocuments.map(item => ({ path: item.path, readOnly: false })), ...topicPages].map(item => [item.path, item])).values()]
  const requestedFile = params.get("file")
  const selectedPath = requestedFile && files.some(file => file.path === requestedFile) ? requestedFile : document.path
  const layoutRef = React.useRef<HTMLDivElement>(null)
  const treeRef = React.useRef<HTMLElement>(null)
  const selectFile = (path: string) => {
    const layout = layoutRef.current
    const tree = treeRef.current
    const viewport = layout?.closest('.page')
    if (layout && tree && viewport && getComputedStyle(tree).position === 'sticky') {
      // Show the next file from its beginning without moving the sticky tree.
      // Reset only the distance already scrolled past the tree's visible top.
      viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + layout.getBoundingClientRect().top - tree.getBoundingClientRect().top), behavior: 'instant' })
    }
    const owner = topicDocuments.filter(item => path === item.path || path.startsWith(item.path.slice(0, -"README.md".length))).sort((a, b) => b.path.length - a.path.length)[0]
    if (owner && owner.path !== document.path) navigate(`/research/${encodeURIComponent(owner.metadata.id)}?file=${encodeURIComponent(path)}`)
    else update({ file: path })
  }
  const followMarkdownLink = (href: string) => {
    const target = relativeMarkdownTarget(selectedPath, href)
    if (!target) return false
    const targetFile = snapshot.pages.find(item => item.path === target.path)
    const targetDocument = snapshot.documents.find(item => item.path === target.path)
    const ownerPath = targetFile?.documentPath ?? targetDocument?.path
    const owner = snapshot.documents.find(item => item.path === ownerPath)
    if (!owner) return false
    if (owner.path === document.path && files.some(file => file.path === target.path)) {
      selectFile(target.path)
      return true
    }
    const query = target.path === owner.path ? "" : `?file=${encodeURIComponent(target.path)}`
    navigate(`${documentHref(owner, snapshot.documents)}${query}${target.hash}`)
    return true
  }
  const [selected, setSelected] = React.useState<ViewFile | null>(null)
  const [error, setError] = React.useState("")
  const [fileAttempt, setFileAttempt] = React.useState(0)
  const [open, setOpen] = React.useState(false)
  const [page, setPage] = React.useState("")
  const [plan, setPlan] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    setSelected(null)
    setError("")
    void api.file(selectedPath, controller.signal).then((file) => {
      if (!controller.signal.aborted) setSelected(file)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => controller.abort()
  }, [api, selectedPath, fileAttempt])
  const ownerDirectory = topicDirectory ?? document.path.slice(0, document.path.lastIndexOf("/") + 1)
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
  const allowed = ["feature", "roadmap", "design", "engineering", "research"].includes(
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
          | "engineering"
          | "research",
        id: document.path,
        page,
        ...(plan ? { plan } : {}),
      },
      "支持页面已创建。"
    )
    setOpen(false)
    setPage("")
  }
  return (
    <div ref={layoutRef} {...stylex.props(documentStyles.fileLayout, !showPathList && documentStyles.singleFileLayout)}>
      {showPathList && <aside ref={treeRef} data-testid="document-file-tree" {...stylex.props(documentStyles.pathList)}>
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
          onSelect={(path) => { if (path !== selectedPath) selectFile(path) }}
        />
      </aside>}
      <section data-testid="document-file-preview" {...stylex.props(documentStyles.preview)}>
        {selected?.path !== selectedPath && toolbarTarget && createPortal(<div className="toolbar-actions">
          <Button variant="outline" size="sm" disabled><RefreshCw /> 重新载入</Button>
          <span role="status">{error ? '载入失败' : '正在载入…'}</span>
        </div>, toolbarTarget)}
        {error && <div className="form-error">{error} <Button size="sm" variant="outline" onClick={() => setFileAttempt((attempt) => attempt + 1)}>重试</Button></div>}
        {selected?.path === selectedPath ? (
          <><MarkdownEditor key={selected.path} initial={selected} onSaved={setSelected} toolbarTarget={toolbarTarget} onFollowLink={followMarkdownLink} />{selected.path === document.path && extra}</>
        ) : (
          !error && <DocumentSkeleton />
        )}
      </section>
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

function MetadataForm({ document }: { document: DocumentRecord }) {
  const { api, refresh, notify } = useWorkspace()
  const [baseline, setBaseline] = React.useState(document)
  const [title, setTitle] = React.useState(document.metadata.title)
  const research = document.metadata.kind === "research" ? document.metadata : null
  const [observedAt, setObservedAt] = React.useState(research?.observedAt ?? "")
  const [sources, setSources] = React.useState(research?.sources.join("\n") ?? "")
  const dirty = title !== baseline.metadata.title ||
    (baseline.metadata.kind === "research" &&
      (observedAt !== (baseline.metadata.observedAt ?? "") ||
        sources !== baseline.metadata.sources.join("\n")))
  const revision = JSON.stringify([title, observedAt, sources])
  const currentRevision = React.useRef(revision)
  currentRevision.current = revision

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
              observedAt: observedAt.trim() || null,
              sources: sources.split("\n").map((value) => value.trim()).filter(Boolean),
            }
          : {}),
      })
      await refresh()
      const latest = await api.workspace()
      const saved = latest.documents.find((item) => item.path === baseline.path)
      if (!saved) throw new Error("保存后无法重新读取文档。")
      flushSync(() => {
        setBaseline(saved)
        if (currentRevision.current === sent) {
          setTitle(saved.metadata.title)
          if (saved.metadata.kind === "research") {
            setObservedAt(saved.metadata.observedAt ?? "")
            setSources(saved.metadata.sources.join("\n"))
          }
        }
      })
    } catch (cause) {
      throw cause
    }
  }
  const autoSave = useAutoSave({ dirty, revision, save: submit, discard: () => {
    setTitle(baseline.metadata.title)
    if (baseline.metadata.kind === "research") {
      setObservedAt(baseline.metadata.observedAt ?? "")
      setSources(baseline.metadata.sources.join("\n"))
    }
  } })
  return (
    <>
      <PanelHeader title="元数据" actions={<span className="form-status" role="status">{autoSave.status}</span>} />
      <ContentSection title="身份信息" className="form-section">
        <dl><Definition label="类型">{humanKind(document.metadata.kind)}</Definition><Definition label="ID"><code>{document.metadata.id}</code></Definition><Definition label="创建于">{document.metadata.createdAt}</Definition></dl>
      </ContentSection>
      <ContentSection title="可编辑字段" className="form-section">
        <form className="form-grid" onSubmit={event => { event.preventDefault(); void autoSave.flush().catch(() => undefined) }}>
          <Field label="标题">
            <Input aria-label="文档标题" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          {baseline.metadata.kind === "research" && (
            <>
              <Field label="观察日期（可选）"><Input aria-label="观察日期" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} /></Field>
              <Field label="来源"><Textarea aria-label="来源" value={sources} onChange={(event) => setSources(event.target.value)} /></Field>
            </>
          )}
          {autoSave.error && <div className="form-error" role="alert">{autoSave.error}<Button type="submit" variant="outline">重试保存</Button></div>}
        </form>
      </ContentSection>
    </>
  )
}

function Lifecycle({ document }: { document: DocumentRecord }) {
  const metadata = document.metadata
  const history = metadata.kind === "memory" || metadata.kind === "issue" ? metadata.history : []
  return (
    <><PanelHeader title="生命周期" /><div className="lifecycle-grid">
      <ContentSection title="当前状态">
          <dl>
            {metadata.kind === "design" && !metadata.decision && !metadata.deferral && <Definition label="状态">待裁决</Definition>}
            {"state" in metadata && <Definition label="状态">{String(metadata.state)}</Definition>}
            {metadata.kind === "roadmap" && metadata.cancellation && <><Definition label="取消理由">{metadata.cancellation.reason}</Definition><Definition label="原文来源">{metadata.cancellation.source.path}</Definition></>}
            {metadata.kind === "design" && metadata.deferral && <><Definition label="状态">已暂缓</Definition><Definition label="暂缓理由">{metadata.deferral.reason}</Definition><Definition label="原文来源">{metadata.deferral.source.path}</Definition></>}
            {metadata.kind === "design" && metadata.decision && <><Definition label="已选择">{metadata.decision.selected}</Definition><Definition label="裁决理由">{metadata.decision.reason}</Definition><Definition label="裁决时间">{metadata.decision.at ?? "原文未记载"}</Definition></>}
          </dl>
      </ContentSection>
      <LifecycleActions document={document} />
      {history.length > 0 && (
        <ContentSection title="历史">
          <div className="timeline">{history.map((entry, index) => (
            <div key={`${entry.at}-${index}`}><i /><strong>{entry.action}</strong><time>{entry.at}</time><p>{entry.reason}</p></div>
          ))}</div>
        </ContentSection>
      )}
    </div></>
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
    return null
  }
  if (metadata.kind === "roadmap" && metadata.state !== "planned" || metadata.kind === "design" && metadata.decision || metadata.kind === "issue" && metadata.state !== "draft") return null
  return (
    <ContentSection title="可用操作" className="form-section">
      <div className="form-grid">
        {metadata.kind === "roadmap" && metadata.state === "planned" && (
          <><Field label="采用为 Feature ID"><Input aria-label="采用为 Feature ID" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button onClick={() => invoke({ action: "roadmap.adopt", id: metadata.id, feature: target }, "Roadmap 已采用为 Feature。")}>采用 Roadmap</Button></>
        )}
        {metadata.kind === "design" && !metadata.decision && (
          <><Field label="选定方案"><Select value={selected} onValueChange={setSelected}><SelectTrigger aria-label="选定设计方案"><SelectValue placeholder="选择方案" /></SelectTrigger><SelectContent>{metadata.alternatives.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Field label="关联目标" hint="每行一个引用"><Textarea aria-label="设计关联目标" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Field label="裁决理由"><Textarea aria-label="设计裁决理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "design.decide", id: metadata.id, selected, targets: target.split("\n").filter(Boolean), reason }, "设计裁决已记录。")}>记录裁决</Button></>
        )}
        {metadata.kind === "memory" && (
          <>
            {metadata.state === "captured" && metadata.memoryKind !== "note" && <><Field label="激活理由"><Textarea aria-label="Memory 激活理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "memory.activate", id: document.path, reason }, "Memory 已激活。")}>激活 Memory</Button></>}
            {metadata.state === "open" ? (
              <><Field label="关闭类型"><Select value={resolution} onValueChange={(value) => setResolution(value as typeof resolution)}><SelectTrigger aria-label="Memory 关闭类型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">Fixed（命令证据）</SelectItem><SelectItem value="not-a-bug">Not a bug</SelectItem><SelectItem value="wont-fix">Won&apos;t fix</SelectItem><SelectItem value="external-fixed">External fixed</SelectItem></SelectContent></Select></Field>{resolution === "fixed" && <div className="two-column"><Field label="Red evidence"><Input aria-label="Red evidence" value={red} onChange={(event) => setRed(event.target.value)} list="evidence-ids" /></Field><Field label="Green evidence"><Input aria-label="Green evidence" value={green} onChange={(event) => setGreen(event.target.value)} list="evidence-ids" /></Field></div>}<Field label="理由"><Textarea aria-label="Memory 关闭理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "memory.resolve", id: document.path, kind: resolution, reason, ...(resolution === "fixed" ? { red, green } : {}) }, "Memory 已关闭。")}>关闭 Memory</Button></>
            ) : (
              <><Field label="重开理由"><Textarea aria-label="Memory 重开理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button variant="outline" onClick={() => invoke({ action: "memory.reopen", id: document.path, reason }, "Memory 已重开。")}>重新打开</Button></>
            )}
            <Field label="目标或替代 Memory"><Input aria-label="Memory 目标" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
            <div className="button-row"><Button variant="outline" onClick={() => invoke({ action: "memory.promote", id: document.path, target }, "Memory 已提升。")}>提升到契约</Button><Button variant="outline" onClick={() => invoke({ action: "memory.supersede", id: document.path, replacement: target, reason }, "Memory 已被替代。")}>标记替代</Button><Button variant="outline" onClick={() => invoke({ action: "memory.retire", id: document.path, target, reason }, "关联已退役。")}>退役关联</Button></div>
            <datalist id="evidence-ids">{snapshot.evidenceIds.map((id) => <option key={id} value={id} />)}</datalist>
          </>
        )}
        {metadata.kind === "issue" && metadata.state === "draft" && (
          <><Field label="关联 Memory"><Input aria-label="关联 Memory" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button variant="outline" onClick={() => invoke({ action: "issue.link", id: metadata.id, memory: target }, "Issue 已关联 Memory。") }><Link2 /> 关联 Memory</Button><Field label="关闭理由"><Textarea aria-label="Issue 关闭理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field><Button onClick={() => invoke({ action: "issue.close", id: metadata.id, reason }, "Issue 已关闭。")}>关闭草稿</Button></>
        )}
      </div>
    </ContentSection>
  )
}
