import { FileText, Folder } from 'lucide-react';
import { projectDocHref, projectDocPages, projectDocTitle } from '../lib/project-docs';
import { researchTopicDirectory, researchTopics } from '../lib/research-topics';
import { Link, useLocation } from 'react-router-dom';
import { useWorkspace } from '../workspace';
import { ContentSidebar, type ContentSidebarGroup } from './content-sidebar';
import { useSidebar } from './ui/sidebar';
import { CreateDocument } from '../pages/documents';

type NavigationKind = 'feature' | 'engineering' | 'roadmap' | 'design' | 'research' | 'memory';
const sections: readonly { href: string; kind: NavigationKind; label: string }[] = [
  { href: '/features', kind: 'feature', label: 'Feature' },
  { href: '/engineering', kind: 'engineering', label: 'Engineering' },
  { href: '/roadmap', kind: 'roadmap', label: 'Roadmap' },
  { href: '/design', kind: 'design', label: 'Design' },
  { href: '/research', kind: 'research', label: 'Research' },
  { href: '/memory', kind: 'memory', label: 'Memory' },
];

export function CloseMobileOnNavigate({ children, href, onClick, ...props }: Omit<React.ComponentProps<typeof Link>, 'to'> & { href: string }) {
  const { setOpenMobile } = useSidebar();
  return <Link {...props} to={href} onClick={event => { onClick?.(event); if (!event.defaultPrevented) setOpenMobile(false); }}>{children}</Link>;
}

export function DocumentNavigation() {
  const { snapshot } = useWorkspace();
  const { pathname, search } = useLocation();
  if (pathname === '/docs') return <ProjectDocNavigation search={search} />;
  const section = sections.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (!section) return null;
  const documents = snapshot.documents.filter(document => document.metadata.kind === section.kind);
  const selected = documents.find(document => pathname.split('/')[2] === encodeURIComponent(document.metadata.id));
  const groups: ContentSidebarGroup[] = [{
    id: 'documents', label: `${section.label} 列表`, emptyMessage: `暂无 ${section.label}`,
    items: section.kind === 'research' ? researchTopics(documents).map(topic => ({
      id: topic.directory, href: `${section.href}/${encodeURIComponent(topic.document.metadata.id)}`,
      title: topic.title, active: selected !== undefined && researchTopicDirectory(selected.path) === topic.directory,
      icon: <Folder size={16} />,
    })) : documents.map(document => ({
      id: document.path, href: `${section.href}/${encodeURIComponent(document.metadata.id)}`,
      title: document.metadata.title, active: selected?.path === document.path, icon: <FileText size={16} />,
    })),
  }];
  return <ContentSidebar key={section.kind} actions={<CreateDocument kind={section.kind} />} model={{ label: section.label, title: section.label,
    filter: { label: `筛选 ${section.label}`, placeholder: '按标题或 ID 筛选…' }, groups }} />;
}

function ProjectDocNavigation({ search }: { readonly search: string }) {
  const { snapshot } = useWorkspace();
  const selected = new URLSearchParams(search).get('file');
  const pages = projectDocPages(snapshot);
  const root = pages.filter(page => !page.path.startsWith('docs/_template/'));
  const templates = pages.filter(page => page.path.startsWith('docs/_template/'));
  const item = (page: typeof pages[number]) => ({
    id: page.path,
    href: projectDocHref(page.path),
    title: projectDocTitle(page),
    active: selected === page.path,
    icon: <FileText size={16} />,
  });
  const groups: ContentSidebarGroup[] = [
    { id: 'project', label: '项目文档', heading: '项目文档', items: root.map(item), emptyMessage: '暂无项目文档' },
    ...(templates.length === 0 ? [] : [{ id: 'templates', label: '参考模板', heading: '参考模板', treeRoot: 'docs/_template/', items: templates.map(item) }]),
  ];
  return <ContentSidebar key="docs" model={{
    label: '文档',
    title: '文档',
    filter: { label: '筛选文档', placeholder: '按标题或路径筛选…' },
    groups,
  }} />;
}
