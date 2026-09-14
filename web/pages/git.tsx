// @concord-file web-workbench-git
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle, FileDiff, ListTree, RefreshCw } from 'lucide-react';
import { Empty, PageHeader } from '../components/page';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DiffReading } from './git/diff-reading';
import { FileTree } from './git/file-tree';
import { AREAS, AREA_LABELS, entriesFor, firstArea, validArea } from './git/model';
import { useGitReview } from './git/use-git-review';

const styles = stylex.create({
  review: {
    display: 'grid', gridTemplateColumns: { default: 'minmax(230px, 285px) minmax(0, 1fr)', '@media (max-width: 767px)': 'minmax(0, 1fr)' },
    height: { default: 'max(420px, calc(100dvh - 280px))', '@media (max-width: 767px)': 'max(400px, calc(100dvh - 320px))' },
    marginTop: 16, overflow: 'hidden', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 'var(--radius)', backgroundColor: 'var(--card)',
  },
  sidebar: { minHeight: 0, overflow: 'auto', borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--border)' },
  navigation: { paddingBlock: 12, paddingInline: 8 },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 5, paddingInline: 8, paddingBottom: 13, fontSize: 13, fontWeight: 600 },
  note: { marginBlock: 12, marginInline: 8, fontSize: 11, color: 'var(--muted-foreground)' },
  toggle: { marginTop: 12 },
  sheet: { overflowY: 'auto' },
  panel: { display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden' },
  header: { flexShrink: 0, padding: 13, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)' },
  path: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, overflowWrap: 'anywhere' },
  icon: { width: 16, flexShrink: 0 },
  controls: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  notice: { display: 'flex', gap: 12, margin: 12, padding: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 7, backgroundColor: 'var(--muted)' },
});

export function GitPage() {
  const state = useGitReview();
  const { git, tab, tree, path, entry, area, view, line, readingKey, visibleDiff } = state;
  const count = tab === 'docs' ? state.docs.length : state.tests.length;
  const navigation = <nav {...stylex.props(styles.navigation)} aria-label="Git 文件树">
    <div {...stylex.props(styles.heading)}>变更文件 <Badge variant="secondary">{count}</Badge></div>
    <FileTree node={tree} selected={path} cases={state.addedCases} select={(file, line) => state.select(file, firstArea(file), line)} />
    {!git ? <p role="status">正在读取 Git 变更…</p> : !count && <p {...stylex.props(styles.note)}>{tab === 'docs' ? '没有 docs 文档变更' : '没有测试文件变更'}</p>}
    {tab === 'tests' && <p {...stylex.props(styles.note)}>{git?.baselineError ? `无法比较新增测试：${git.baselineError}` : '新增声明列在所属文件下；diff 按文件展示。'}</p>}
  </nav>;
  return <>
    <PageHeader eyebrow={git?.branch ?? 'Git'} title="工作树变更" description="从文件树选择变更，在右侧审阅 Git diff。" actions={<Button variant="outline" onClick={state.refreshGit}><RefreshCw />刷新</Button>} />
    <Tabs value={tab} onValueChange={state.changeCategory}><TabsList aria-label="变更分类">
      <TabsTrigger value="docs">Docs 变更 <Badge variant="secondary">{state.docs.length}</Badge></TabsTrigger>
      <TabsTrigger value="tests">测试用例变更 <Badge variant="secondary">{state.tests.length}</Badge></TabsTrigger>
    </TabsList></Tabs>
    {state.isMobile && <Sheet open={state.navigationOpen} onOpenChange={state.setNavigationOpen}>
      <SheetTrigger asChild><Button variant="outline" {...stylex.props(styles.toggle)}><ListTree />变更文件</Button></SheetTrigger>
      <SheetContent side="left" {...stylex.props(styles.sheet)} aria-describedby={undefined}><SheetHeader><SheetTitle>变更文件</SheetTitle></SheetHeader>{navigation}</SheetContent>
    </Sheet>}
    <div {...stylex.props(styles.review)} data-testid="git-review">
      {!state.isMobile && <aside {...stylex.props(styles.sidebar)}>{navigation}</aside>}
      <section {...stylex.props(styles.panel)} data-git-diff aria-label="Git diff">
        {entry && <header {...stylex.props(styles.header)}><div {...stylex.props(styles.path)}><FileDiff {...stylex.props(styles.icon)} /><strong>{path}</strong>{entry.conflicted && <Badge variant="destructive">冲突</Badge>}</div>
          {entry.previousPath && <p {...stylex.props(styles.note)}>从 {entry.previousPath}</p>}
          <div {...stylex.props(styles.controls)}><Tabs value={area} onValueChange={value => { if (validArea(value)) state.select(entry, value); }}><TabsList aria-label="变更区域">
            {AREAS.filter(area => entriesFor([entry], area).length).map(area => <TabsTrigger key={area} value={area}>{AREA_LABELS[area]}</TabsTrigger>)}
          </TabsList></Tabs><Tabs value={view} onValueChange={value => state.setView(value as typeof view)}><TabsList aria-label="Diff 布局">
            <TabsTrigger value="split">分栏</TabsTrigger><TabsTrigger value="unified">统一</TabsTrigger>
          </TabsList></Tabs></div>
        </header>}
        {state.error && <div {...stylex.props(styles.notice)}><AlertTriangle /><div><strong>无法读取 diff</strong><p>{state.error}</p></div></div>}
        {visibleDiff ? <DiffReading key={readingKey} value={visibleDiff} view={view} line={line} position={state.positions.current.get(readingKey) ?? 0} remember={position => state.positions.current.set(readingKey, position)} /> : !state.error && (!git || entry ? <p role="status">正在读取 diff…</p> : <Empty title="没有可审阅的变更" />)}
      </section>
    </div>
  </>;
}
