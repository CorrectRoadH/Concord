import { fromMarkdown } from 'mdast-util-from-markdown'
import { PathContextMenu } from '../components/path-context-menu.tsx'
import { DOCUMENT_NAME_PATTERN } from '../../src/model/index.ts'
import { matchingOwners } from '../../src/model/index.ts'
import { documentHref } from '../lib/document-routing.ts'
export { documentHref } from '../lib/document-routing.ts'
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
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom"

import type { DocumentKind, DocumentRecord } from '../../src/model/index.ts'
import type { ViewAction, ViewFile } from '../../src/model/index.ts'
import type { WorkspaceDocument, WorkspacePage } from '../../src/model/index.ts'
import { TEMPLATE_PAGES, PAGE_DESCRIPTIONS, type TemplatePage } from '../../src/model/index.ts'
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
import { projectionIsConclusive, useWorkspace } from "@/workspace"

import { contractIdentities, ImplementationPanel, TestingPanel } from './operations.tsx'

const descriptions: Record<string, string> = {
  feature: "当前交付目标；Use Case 只在所属 Feature 内维护。",
  engineering: "测试、构建与维护机制的工程 Spec。",
  roadmap: "尚未采用的方向与演进计划。",
  design: "需要决定的取舍、候选做法及其代价。",
  memory: "Decision、Insight 与 Note 的工程记忆。",
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
  treeContainer: { containerType: "inline-size", containerName: "package-files", minWidth: 0 },
  fileLayout: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(200px, 240px) minmax(0, 1fr)", "@container package-files (width < 960px)": "minmax(0, 1fr)" },
    alignItems: "start",
    gap: 16,
    // Keep the sticky tree supported even when the next file is short.
    minHeight: { default: "calc(100svh - 76px)", "@container package-files (width < 960px)": 0 },
  },
  singleFileLayout: { gridTemplateColumns: "minmax(0, 1fr)" },
  tabPanel: { flex: "none", minHeight: 0 },
  bodyPanel: { overflow: "visible" },
  pathList: {
    position: { default: "sticky", "@container package-files (width < 960px)": "static" },
    top: 68,
    maxHeight: { default: "calc(100svh - 180px)", "@container package-files (width < 960px)": 280 },
    overflowY: "auto",
    scrollbarWidth: "none",
    minWidth: 0,
    paddingRight: { default: 16, "@container package-files (width < 960px)": 0 },
    borderRightWidth: { default: 1, "@container package-files (width < 960px)": 0 },
    borderRightStyle: "solid",
    borderRightColor: "var(--border)",
  },
  preview: { minWidth: 0, minHeight: 0 },
  tree: { display: "grid", gap: 1 },
  treeContent: { display: { default: "block", "@container package-files (width < 960px)": "none" } },
  treeContentOpen: { display: "block" },
  treeDisclosure: {
    display: { default: "none", "@container package-files (width < 960px)": "grid" },
    gridTemplateColumns: "14px auto minmax(0, 1fr)",
    columnGap: 7,
    alignItems: "center",
    width: "100%",
    padding: 8,
    borderWidth: 0,
    color: "inherit",
    backgroundColor: { default: "transparent", ":hover": "var(--accent)" },
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": "2px solid var(--ring)" },
    outlineOffset: -2,
  },
  treeCurrentFile: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted-foreground)" },
  treeDirectoryRow: { display: "flex", minWidth: 0, borderRadius: 7 },
  treeDirectoryButton: { flex: 1, gridTemplateColumns: "14px minmax(0, 1fr)", paddingLeft: 0 },
  treeToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    // 与文件行的左内边距、占位图标和列间距一致，使同层图标严格对齐。
    width: 29,
    padding: 0,
    borderWidth: 0,
    borderRadius: 7,
    color: "inherit",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": "var(--accent)" },
    outline: { default: "none", ":focus-visible": "2px solid var(--ring)" },
    outlineOffset: -2,
  },
  nested: { marginLeft: 10, paddingLeft: 7, borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: "var(--border)" },
  treeRow: {
    display: "grid",
    gridTemplateColumns: "14px 14px minmax(0, 1fr) auto",
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
    outline: { default: "none", ":focus-visible": "2px solid var(--ring)" },
    outlineOffset: -2,
  },
  selectedTreeRow: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
  treeIcon: { width: 14, height: 14, flexShrink: 0, color: "var(--muted-foreground)" },
  chevron: { transition: "transform 120ms ease" },
  openChevron: { transform: "rotate(90deg)" },
  treeSpacer: { flexShrink: 0, width: 14 },
  treeName: { minWidth: 0, overflow: "hidden", fontWeight: 600, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  skeleton: { minHeight: 520, padding: "48px clamp(28px, 7vw, 100px)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--border)", borderRadius: "var(--radius)", backgroundColor: "var(--card)" },
  skeletonTitle: { width: "58%", height: 48, marginBottom: 28, borderRadius: 8, backgroundColor: "var(--muted)", animationName: stylex.keyframes({ "0%, 100%": { opacity: .45 }, "50%": { opacity: .9 } }), animationDuration: "1.25s", animationIterationCount: "infinite" },
  skeletonLine: { height: 17, marginBottom: 14, borderRadius: 5, backgroundColor: "var(--muted)", animationName: stylex.keyframes({ "0%, 100%": { opacity: .4 }, "50%": { opacity: .78 } }), animationDuration: "1.25s", animationIterationCount: "infinite" },
  skeletonLineLong: { width: "100%" },
  skeletonLineMedium: { width: "82%" },
  skeletonLineShort: { width: "66%" },
})

// @concord-code
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#验收
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

import { featureMatches, featureUseCases } from '../lib/workspace-display.ts'

function fire(task: Promise<unknown>): void {
  void task.catch(() => undefined)
}

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
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
  const [pages, setPages] = React.useState<TemplatePage[]>([])
  const selectablePages = kind === "feature" || kind === "engineering" || kind === "roadmap"
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
            {selectablePages && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">页面模板</legend>
                <p className="text-sm text-muted-foreground">README 必需。其余按需选择，之后也可添加。</p>
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

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md#web-组件组合
// @concord-implements docs/feature/web-workbench/ui.md
export function DocumentsListPage({
  kind,
}: {
  kind: Exclude<DocumentKind, "use-case">
}) {
  const { snapshot, projection, dirty } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()
  const conclusive = projectionIsConclusive(projection)
  const [filter, setFilter] = React.useState("")
  const previewsFirst = ["feature", "engineering", "roadmap", "design", "memory"].includes(kind)
  const first = previewsFirst ? snapshot.documents.find(document => document.metadata.kind === kind) : undefined
  React.useEffect(() => {
    // A selection can change the browser URL before this render's effect runs.
    // A delayed category default must not replace that newer selection.
    if (!first || dirty || window.location.pathname !== location.pathname) return
    void navigate(documentHref(first, snapshot.documents), { replace: true })
  }, [first, dirty, location.pathname, navigate, snapshot.documents])
  const documents = snapshot.documents.filter(
    (document) =>
      document.metadata.kind === kind &&
      `${document.metadata.title} ${document.metadata.id} ${document.path}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase())
  )
  if (first) return null

  return (
    <>
      <PageHeader
        title={humanKind(kind)}
        description={descriptions[kind]}
        actions={!["feature", "engineering", "roadmap", "design", "memory"].includes(kind) ? <CreateDocument kind={kind} /> : undefined}
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
        <Empty kind={filter ? "filtered" : "empty"} title={conclusive ? filter ? "没有匹配的文档" : `还没有 ${humanKind(kind)}` : `当前结果未显示${humanKind(kind)}`}>
          {conclusive ? filter ? "调整筛选条件后重试。" : "使用新建入口创建第一项。" : "投影尚未完整且一致，暂时无法确认是否还有匹配项。"}
        </Empty>
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

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md#web-组件组合
function DocumentSummary({ document }: { document: WorkspaceDocument }) {
  const metadata = document.metadata
  if (metadata.kind === "roadmap") {
    return <Badge variant="secondary">{metadata.state}</Badge>
  }
  return null
}

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md#项目测试只读投影
export function FeatureDetailPage() {
  const navigation = useUrlNavigation()
  const { id = "", useCaseId } = useParams()
  const { snapshot, projection } = useWorkspace()
  const conclusive = projectionIsConclusive(projection)
  const feature = snapshot.documents.find(
    (document) =>
      document.metadata.kind === "feature" && document.metadata.id === id
  )
  if (!feature) {
    return conclusive
      ? <Empty kind="missing" title="找不到 Feature">它可能已被移动或删除。</Empty>
      : <Empty title="当前结果未包含此 Feature">投影尚未完整且一致，暂时无法确认它是否存在。</Empty>
  }
  const useCases = featureUseCases(snapshot, feature)
  const nested = (
    <section className="feature-use-cases">
      <PanelHeader title="Use Cases" actions={<CreateDocument kind="use-case" feature={feature.path} />} />
      {useCases.length === 0 ? (
        <PanelEmpty title={conclusive ? "还没有 Use Case" : "当前结果暂未显示 Use Case"}>
          {conclusive ? `从这里创建时会自动绑定 ${feature.metadata.title}。` : "投影尚未完整且一致，暂时无法确认是否还有 Use Case。"}
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

// @concord-code
// @concord-implements docs/feature/web-workbench/architecture.md#url-与导航状态
export function UseCaseDrawer() {
  const navigation = useUrlNavigation()
  const { id, useCaseId } = useParams()
  const { snapshot, projection } = useWorkspace()
  const conclusive = projectionIsConclusive(projection)
  const navigate = useNavigate()
  const feature = snapshot.documents.find(item => item.metadata.kind === "feature" && item.metadata.id === id)
  const document = snapshot.documents.find(item => item.metadata.kind === "use-case" && item.metadata.id === useCaseId && feature !== undefined && featureMatches(item.metadata.feature, feature))
  const close = () => navigation.close(`/features/${encodeURIComponent(id ?? "")}?tab=use-cases`)
  return <DetailDrawer open onClose={close} model={{
    title: document?.metadata.title ?? (conclusive ? "找不到 Use Case" : "当前结果未包含此 Use Case"),
    description: `所属 Feature：${feature?.metadata.title ?? id}`,
  }}>
    {document ? <DocumentLayout key={document.path} document={document} /> : conclusive
      ? <Empty kind="missing" title="找不到 Use Case">此 Feature 下没有该 Use Case。</Empty>
      : <Empty title="当前结果未包含此 Use Case">投影尚未完整且一致，暂时无法确认它是否存在。</Empty>}
  </DetailDrawer>
}

// @concord-code
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
export function DocumentDetailPage({ kind, relatedContent }: { kind: DocumentKind; relatedContent?: React.ReactNode }) {
  const params = useParams()
  const id = kind === "use-case" ? params.useCaseId : params.id
  const { snapshot, projection } = useWorkspace()
  const conclusive = projectionIsConclusive(projection)
  const matches = matchingOwners(snapshot.documents, id ?? '', kind)
  const document = matches.length === 1 ? matches[0] : undefined
  if (!document) {
    return conclusive
      ? <Empty kind="missing" title={`找不到 ${humanKind(kind)}`}>它可能已被移动或删除。</Empty>
      : <Empty title={`当前结果未包含此${humanKind(kind)}`}>投影尚未完整且一致，暂时无法确认它是否存在。</Empty>
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
  const layoutKey = document.path
  return <>{back}<DocumentLayout key={layoutKey} document={document} relatedContent={relatedContent} /></>
}

// @concord-code
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
function DocumentLayout({
  document,
  extra,
  relatedContent,
  background = false,
}: {
  document: WorkspaceDocument
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

// @concord-code
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
// @concord-implements docs/feature/web-workbench/ui.md#自动保存
function DocumentFiles({
  document,
  pages,
  extra,
  toolbarTarget,
}: {
  document: WorkspaceDocument
  pages: readonly WorkspacePage[]
  extra?: React.ReactNode
  toolbarTarget?: HTMLElement | null
}) {
  const { act, api, snapshot } = useWorkspace()
  const navigate = useNavigate()
  const { params, update } = useUrlNavigation()
  const files = [{ path: document.path }, ...pages];
  const requestedFile = params.get("file")
  const selectedPath = requestedFile && files.some(file => file.path === requestedFile) ? requestedFile : document.path
  const layoutRef = React.useRef<HTMLDivElement>(null)
  const treeRef = React.useRef<HTMLElement>(null)
  const [fileListOpen, setFileListOpen] = React.useState(false)
  const fileListId = React.useId()
  const selectFile = (path: string) => {
    const layout = layoutRef.current
    const tree = treeRef.current
    const viewport = layout?.closest('.page')
    if (layout && tree && viewport && getComputedStyle(tree).position === 'sticky') {
      // Show the next file from its beginning without moving the sticky tree.
      // Reset only the distance already scrolled past the tree's visible top.
      viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + layout.getBoundingClientRect().top - tree.getBoundingClientRect().top), behavior: 'instant' })
    }
    update({ file: path })
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
  const ownerDirectory = document.path.slice(0, document.path.lastIndexOf("/") + 1)
  const tree = React.useMemo(() => buildFileTree(files, ownerDirectory), [files, ownerDirectory])
  const manualExpansion = React.useRef({ ownerDirectory, paths: new Set<string>() })
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set(treeDirectoryPaths(selectedPath, ownerDirectory)))
  React.useEffect(() => {
    if (manualExpansion.current.ownerDirectory !== ownerDirectory) manualExpansion.current = { ownerDirectory, paths: new Set() }
    setExpanded(new Set([...manualExpansion.current.paths, ...treeDirectoryPaths(selectedPath, ownerDirectory)]))
    setFileListOpen(false)
  }, [ownerDirectory, selectedPath])
  const allowed = ["feature", "roadmap", "engineering"].includes(
    document.metadata.kind
  )
  const showPathList = allowed || pages.length > 0
  return (
    <div {...stylex.props(documentStyles.treeContainer)}>
    <div ref={layoutRef} {...stylex.props(documentStyles.fileLayout, !showPathList && documentStyles.singleFileLayout)}>
      {showPathList && <aside ref={treeRef} data-testid="document-file-tree" {...stylex.props(documentStyles.pathList)}>
        <button type="button" aria-expanded={fileListOpen} aria-controls={fileListId} aria-label="文件" title={selectedPath.slice(ownerDirectory.length)} {...stylex.props(documentStyles.treeDisclosure)} onClick={() => setFileListOpen(current => !current)}>
          <ChevronRight {...stylex.props(documentStyles.treeIcon, documentStyles.chevron, fileListOpen && documentStyles.openChevron)} />
          <strong>文件</strong>
          <span {...stylex.props(documentStyles.treeCurrentFile)}>{selectedPath.split("/").at(-1)}</span>
        </button>
        <div id={fileListId} {...stylex.props(documentStyles.treeContent, fileListOpen && documentStyles.treeContentOpen)}>
        <div className="section-heading section-heading--compact">
          <strong>文件</strong>

        </div>
        <FileTree
          nodes={tree}
          ownerDirectory={ownerDirectory}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={(path) => {
            const next = new Set(expanded)
            if (next.has(path)) {
              next.delete(path)
              manualExpansion.current.paths.delete(path)
            } else {
              next.add(path)
              manualExpansion.current.paths.add(path)
            }
            setExpanded(next)
          }}
          onSelect={(path) => { setFileListOpen(false); if (path !== selectedPath) selectFile(path) }}
        />
        </div>
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

    </div>
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
  readonly directory: boolean
  readonly children: readonly FileTreeNode[]
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/README.md#文档阅读与编辑
function buildFileTree(files: readonly { path: string }[], ownerDirectory: string): readonly FileTreeNode[] {
  type MutableNode = { name: string; relativePath: string; path?: string; directory: boolean; children: MutableNode[] }
  const root: MutableNode = { name: "", relativePath: "", directory: true, children: [] }
  for (const file of files) {
    const relative = file.path.startsWith(ownerDirectory) ? file.path.slice(ownerDirectory.length) : file.path
    let parent = root
    const segments = relative.split("/")
    for (const [index, name] of segments.entries()) {
      const last = index === segments.length - 1
      if (last && name === "README.md" && index > 0) {
        parent.path = file.path
        break
      }
      const relativePath = segments.slice(0, index + 1).join("/")
      let node = parent.children.find((item) => item.name === name)
      if (!node) {
        node = { name, relativePath, directory: !last, children: [] }
        parent.children.push(node)
      }
      if (last) {
        node.path = file.path
      }
      parent = node
    }
  }
  const sort = (nodes: MutableNode[]): MutableNode[] => nodes
    .sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name))
    .map((node) => ({ ...node, children: sort(node.children) }))
  return sort(root.children)
}

function treeDirectoryPaths(selectedPath: string, ownerDirectory: string): readonly string[] {
  const relative = selectedPath.startsWith(ownerDirectory) ? selectedPath.slice(ownerDirectory.length) : selectedPath
  const segments = relative.split("/")
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"))
}

function FileTree({ nodes, ownerDirectory, expanded, selectedPath, onToggle, onSelect, depth = 0 }: {
  nodes: readonly FileTreeNode[]
  ownerDirectory: string
  expanded: ReadonlySet<string>
  selectedPath: string
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  depth?: number
}) {
  return <div {...stylex.props(documentStyles.tree, depth > 0 && documentStyles.nested)}>{nodes.map((node) => {
    const directory = node.directory
    const open = expanded.has(node.relativePath)
    return <React.Fragment key={node.relativePath}>
      {directory ? <PathContextMenu path={`${ownerDirectory}${node.relativePath}`}><div {...stylex.props(documentStyles.treeDirectoryRow, node.path === selectedPath && documentStyles.selectedTreeRow)}>
        <button type="button" aria-label={`${open ? "折叠" : "展开"} ${node.relativePath}`} aria-expanded={open} title={node.relativePath} {...stylex.props(documentStyles.treeToggle)} onClick={() => onToggle(node.relativePath)}>
          <ChevronRight {...stylex.props(documentStyles.treeIcon, documentStyles.chevron, open && documentStyles.openChevron)} />
        </button>
        <button type="button" data-active={node.path === selectedPath || undefined} aria-label={node.relativePath} aria-expanded={node.path ? undefined : open} title={node.relativePath} {...stylex.props(documentStyles.treeRow, documentStyles.treeDirectoryButton, node.path === selectedPath && documentStyles.selectedTreeRow)} onClick={() => node.path ? onSelect(node.path) : onToggle(node.relativePath)}>
          <Folder {...stylex.props(documentStyles.treeIcon)} />
          <span {...stylex.props(documentStyles.treeName)}>{node.name}</span>
        </button>
      </div></PathContextMenu> : <PathContextMenu path={node.path ?? `${ownerDirectory}${node.relativePath}`}><button
        type="button"
        data-active={node.path === selectedPath || undefined}
        aria-label={node.relativePath}
        title={node.relativePath}
        {...stylex.props(documentStyles.treeRow, node.path === selectedPath && documentStyles.selectedTreeRow)}
        onClick={() => node.path && onSelect(node.path)}
      >
        <span {...stylex.props(documentStyles.treeSpacer)} /><FileText {...stylex.props(documentStyles.treeIcon)} />
        <span {...stylex.props(documentStyles.treeName)}>{node.name}</span>
      </button></PathContextMenu>}
      {directory && open && <FileTree ownerDirectory={ownerDirectory} nodes={node.children} expanded={expanded} selectedPath={selectedPath} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} />}
    </React.Fragment>
  })}</div>
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/web-workbench/ui.md#自动保存
function MetadataForm({ document }: { document: WorkspaceDocument }) {
  const metadata = document.metadata
  return <><PanelHeader title="文档信息" /><ContentSection title="来源"><dl>
    <Definition label="类型">{humanKind(metadata.kind)}</Definition>
    <Definition label="路径"><code>{document.path}</code></Definition>
  </dl></ContentSection>{metadata.kind !== "memory" && metadata.kind !== "issue" && <HeadingEditor key={document.path} path={document.path} />}</>
}

/** The title control edits the level-one heading and saves the same whole-file preimage as the source editor. */
function HeadingEditor({ path }: { path: string }) {
  const { api, requestRefresh } = useWorkspace()
  const [baseline, setBaseline] = React.useState<ViewFile | null>(null)
  const [title, setTitle] = React.useState("")
  const [error, setError] = React.useState("")
  React.useEffect(() => {
    const controller = new AbortController()
    void api.file(path, controller.signal).then(file => {
      if (controller.signal.aborted) return
      setBaseline(file); setTitle(file.document?.metadata.title ?? "")
    }).catch(cause => { if (!controller.signal.aborted) setError(String(cause)) })
    return () => controller.abort()
  }, [api, path])
  const revision = React.useRef(title)
  revision.current = title
  const save = async () => {
    if (!baseline) return
    const sent = title
    const heading = fromMarkdown(baseline.body).children.find(node => node.type === 'heading' && node.depth === 1)
    if (!heading?.position || !sent.trim()) throw new Error("文档需要非空一级标题。")
    const original = baseline.body.slice(heading.position.start.offset, heading.position.end.offset)
    const anchor = /\s+(\{#[^{}\s]+\})\s*$/u.exec(original)?.[1]
    const body = `${baseline.body.slice(0, heading.position.start.offset)}# ${sent}${anchor ? ` ${anchor}` : ''}${baseline.body.slice(heading.position.end.offset)}`
    await api.action({ action: 'document.set', path, body, expectedDigest: baseline.digest })
    const saved = await api.file(path)
    flushSync(() => { setBaseline(saved); if (revision.current === sent) setTitle(saved.document?.metadata.title ?? sent) })
    await requestRefresh().catch(() => undefined)
  }
  const autoSave = useAutoSave({ dirty: baseline !== null && title !== baseline.document?.metadata.title, revision: title, save, discard: () => setTitle(baseline?.document?.metadata.title ?? "") })
  if (error) return <p role="alert">{error}</p>
  if (!baseline) return <p role="status">正在读取标题…</p>
  return <ContentSection title="一级标题"><Field label="标题"><Input aria-label="文档标题" value={title} onChange={event => setTitle(event.target.value)} /></Field><span role="status">{autoSave.status}</span>{autoSave.error && <p role="alert">{autoSave.error}</p>}</ContentSection>
}

// @concord-begin
// @concord-implements docs/feature/web-workbench/use-case/handle-lifecycle-in-workbench.md
function Lifecycle({ document }: { document: WorkspaceDocument }) {
  const metadata = document.metadata
  return (
    <><PanelHeader title="生命周期" /><div className="lifecycle-grid">
      <ContentSection title="当前状态">
          <dl>
            {metadata.kind === "roadmap" && <Definition label="状态">{metadata.state}</Definition>}
            {metadata.kind === "design" && <Definition label="状态">待定取舍</Definition>}
            {metadata.kind === "roadmap" && metadata.adoptedAs && <Definition label="采用为 Feature">{metadata.adoptedAs}</Definition>}
            {(metadata.kind === "memory" || metadata.kind === "issue") && (metadata.relations ?? []).map(relation => <Definition key={`${relation.role}:${relation.target}`} label={relation.role}>{relation.target}</Definition>)}
            {metadata.kind === "roadmap" && metadata.cancellation && <><Definition label="取消理由">{metadata.cancellation.reason}</Definition>{metadata.cancellation.source && <Definition label="原文来源">{metadata.cancellation.source.path}</Definition>}</>}
          </dl>
          {metadata.kind === "design" && <p>决定后将规则写入 Spec，并删除 Design。</p>}
      </ContentSection>
      <LifecycleActions document={document} />

    </div></>
  )
}

function LifecycleActions({ document }: { document: WorkspaceDocument }) {
  const { act } = useWorkspace()
  const metadata = document.metadata
  const [reason, setReason] = React.useState("")
  const [target, setTarget] = React.useState("")
  const [pending, setPending] = React.useState(false)
  function invoke(action: ViewAction, text: string): void {
    if (pending) return
    setPending(true)
    fire(act(action, text).then(() => setReason("")).finally(() => setPending(false)))
  }
  if (!["roadmap", "memory", "issue"].includes(metadata.kind) || metadata.kind === "roadmap" && metadata.state !== "planned") {
    return null
  }
  return (
    <ContentSection title="可用操作" className="form-section">
      <div className="form-grid">
        {metadata.kind === "roadmap" && metadata.state === "planned" && (
          <><Field label="采用为 Feature ID"><Input aria-label="采用为 Feature ID" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button disabled={pending} onClick={() => invoke({ action: "roadmap.start", id: metadata.id, ...(target ? { feature: target } : {}) }, "Roadmap 已采用为 Feature。")}>采用 Roadmap</Button></>
        )}
        {metadata.kind === "memory" && (
          <>
            <Field label="Spec 目标"><Input aria-label="Memory 目标" value={target} onChange={(event) => setTarget(event.target.value)} /></Field><Button variant="outline" disabled={pending} onClick={() => invoke({ action: "memory.link", id: document.path, target }, "Memory 已关联。")}>关联 Spec</Button>
          </>
        )}
        {metadata.kind === "issue" && (
          <>
            <Field label="关联 Memory"><Input aria-label="关联 Memory" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
            <Button variant="outline" disabled={pending} onClick={() => invoke({ action: "issue.link", id: metadata.id, memory: target }, "Issue 已关联 Memory。") }><Link2 data-icon="inline-start" />关联 Memory</Button>
            <Field label="关闭理由"><Textarea aria-label="Issue 关闭理由" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
            <Button disabled={pending || !reason.trim()} onClick={() => invoke({ action: "issue.close", id: metadata.id, reason }, "Issue 已关闭。")}>关闭草稿</Button>
          </>
        )}
      </div>
    </ContentSection>
  )
}
// @concord-end
