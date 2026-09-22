// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { GitBranch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { MarkdownEditor } from '../components/markdown-editor';
import { Button } from '../components/ui/button';
import { useUrlNavigation } from '../hooks/use-url-navigation';
import { projectDocHref, projectDocPages, projectDocTitle } from '../lib/project-docs';
import { documentHref, relativeMarkdownTarget } from './documents';
import { Empty, PageHeader } from '../components/page';
import { useWorkspace } from '../workspace';
import type { ViewFile } from '../../src/view-contract';

export function ProjectDocsPage() {
  const { snapshot, api } = useWorkspace();
  const navigate = useNavigate();
  const pages = projectDocPages(snapshot);
  const { params } = useUrlNavigation();
  const requested = params.get('file');
  const selectedPath = requested && pages.some(page => page.path === requested) ? requested : pages[0]?.path;
  const [selected, setSelected] = useState<ViewFile | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedPath) return undefined;
    const controller = new AbortController();
    setSelected(null);
    setError('');
    void api.file(selectedPath, controller.signal).then(file => {
      if (!controller.signal.aborted) setSelected(file);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [api, attempt, selectedPath]);

  if (!selectedPath) {
    return <><PageHeader title="文档" description="docs 下还没有可查看的项目文档。" /><Empty title="没有项目文档">初始化后的架构、宪法和参考模板会出现在这里。</Empty></>;
  }
  if (requested !== selectedPath) return <Navigate to={projectDocHref(selectedPath)} replace />;

  const listed = pages.find(page => page.path === selectedPath);
  const title = projectDocTitle(listed ?? { path: selectedPath, body: selected?.body ?? '' });
  const follow = (href: string) => {
    const target = relativeMarkdownTarget(selectedPath, href);
    if (!target) return false;
    if (pages.some(page => page.path === target.path)) {
      navigate(`${projectDocHref(target.path)}${target.hash}`);
      return true;
    }
    const targetFile = snapshot.pages.find(item => item.path === target.path);
    const targetDocument = snapshot.documents.find(item => item.path === target.path);
    const owner = snapshot.documents.find(item => item.path === (targetFile?.documentPath ?? targetDocument?.path));
    if (!owner) return false;
    const query = target.path === owner.path ? '' : `?file=${encodeURIComponent(target.path)}`;
    navigate(`${documentHref(owner)}${query}${target.hash}`);
    return true;
  };

  return <>
    <header className="page-header">
      <p className="path-text">{selectedPath}</p>
      <div className="page-header__actions">
        <Button asChild variant="outline" size="sm"><Link to={`/git?path=${encodeURIComponent(selectedPath)}`}><GitBranch /> 查看 Git 变更</Link></Button>
        <div ref={setToolbar} className="document-editor-actions" />
      </div>
    </header>
    <section data-testid="project-doc-preview" aria-label={selectedPath}>
      {error && <div className="form-error" role="alert">{error} <Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重试</Button></div>}
      {selected?.path === selectedPath
        ? <MarkdownEditor key={selected.path} initial={selected} title={title} onSaved={setSelected} toolbarTarget={toolbar} onFollowLink={follow} />
        : !error && <p role="status">正在载入…</p>}
    </section>
  </>;
}
