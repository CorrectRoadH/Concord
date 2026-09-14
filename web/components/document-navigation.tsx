import { FileText } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkspace } from '../workspace';
import { ContentSidebar, type ContentSidebarGroup } from './content-sidebar';
import { useSidebar } from './ui/sidebar';

type NavigationKind = 'feature' | 'engineering' | 'roadmap' | 'design' | 'research';
const sections: readonly { href: string; kind: NavigationKind; label: string }[] = [
  { href: '/features', kind: 'feature', label: 'Feature' },
  { href: '/engineering', kind: 'engineering', label: 'Engineering' },
  { href: '/roadmap', kind: 'roadmap', label: 'Roadmap' },
  { href: '/design', kind: 'design', label: 'Design' },
  { href: '/research', kind: 'research', label: 'Research' },
];

export function CloseMobileOnNavigate({ children, href, onClick, ...props }: Omit<React.ComponentProps<typeof Link>, 'to'> & { href: string }) {
  const { setOpenMobile } = useSidebar();
  return <Link {...props} to={href} onClick={event => { onClick?.(event); if (!event.defaultPrevented) setOpenMobile(false); }}>{children}</Link>;
}

export function DocumentNavigation() {
  const { snapshot } = useWorkspace();
  const { pathname, search } = useLocation();
  const selectedPath = new URLSearchParams(search).get('path');
  const legacySelectedPath = new URLSearchParams(search).get('legacyPath');
  const selectedPage = pathname === '/pages' ? snapshot.pages.find(page => page.path === selectedPath) : undefined;
  const pageOwner = snapshot.documents.find(document => document.path === selectedPage?.documentPath);
  const section = sections.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`) || pageOwner?.metadata.kind === item.kind)
    ?? (pathname.startsWith('/legacy/features') ? sections[0] : undefined);
  if (!section) return null;
  const documents = snapshot.documents.filter(document => document.metadata.kind === section.kind);
  const legacyFeatures = section.kind === 'feature' ? snapshot.legacyDocuments.filter(document => document.kind === 'feature') : [];
  const selected = pageOwner ?? documents.find(document => pathname.split('/')[2] === encodeURIComponent(document.metadata.id));
  const groups: ContentSidebarGroup[] = [{
    id: 'documents', label: `${section.label} 列表`, emptyMessage: `暂无 ${section.label}`,
    items: [...documents.map(document => ({
      id: document.path, href: `${section.href}/${encodeURIComponent(document.metadata.id)}`,
      title: document.metadata.title, active: selected?.path === document.path, icon: <FileText size={16} />,
    })), ...legacyFeatures.map(document => ({
      id: document.path, href: `/features?legacyPath=${encodeURIComponent(document.path)}`,
      title: document.title, active: legacySelectedPath === document.path, icon: <FileText size={16} />,
    }))],
  }];
  return <ContentSidebar key={section.kind} model={{ label: section.label, title: section.label,
    filter: { label: `筛选 ${section.label}`, placeholder: '按标题或 ID 筛选…' }, groups }} />;
}
