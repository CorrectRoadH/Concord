import { ArrowLeft, ChevronRight, Folder, List } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/use-mobile';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

interface SidebarItemContent {
  readonly id: string;
  readonly title: string;
  readonly active?: boolean;
  readonly icon?: ReactNode;
  readonly searchText?: string;
  readonly ariaLabel?: string;
  readonly suffix?: ReactNode;
}
export type ContentSidebarItem = SidebarItemContent & ({ readonly href: string; readonly onSelect?: never } | { readonly onSelect: () => void; readonly href?: never });

type SidebarSlot = ReactNode | ((close: () => void) => ReactNode);

export interface ContentSidebarGroup {
  readonly id: string;
  readonly label: string;
  readonly heading?: string;
  readonly items: readonly ContentSidebarItem[];
  readonly emptyMessage?: string;
  readonly treeRoot?: string;
  readonly filterable?: boolean;
  readonly actions?: SidebarSlot;
  readonly footer?: SidebarSlot;
  readonly content?: SidebarSlot;
}
export interface ContentSidebarModel {
  readonly label: string;
  readonly title: string;
  readonly back?: { readonly title: string; readonly href: string };
  readonly groups: readonly ContentSidebarGroup[];
  readonly filter?: { readonly label: string; readonly placeholder: string; readonly value?: string; readonly onChange?: (value: string) => void };
}

export function SidebarItem({ item, label = item.title, tooltip = item.title, onNavigate }: { item: ContentSidebarItem; label?: string; tooltip?: string; onNavigate(): void }) {
  const content = <>{item.icon}<span>{label}</span>{item.suffix}</>;
  return item.onSelect
    ? <button className="document-navigation__item" type="button" aria-label={item.ariaLabel} title={tooltip} aria-current={item.active ? 'page' : undefined} onClick={() => { item.onSelect(); onNavigate(); }}>{content}</button>
    : <Link className="document-navigation__item" to={item.href} aria-label={item.ariaLabel} title={tooltip} aria-current={item.active ? 'page' : undefined} onClick={onNavigate}>{content}</Link>;
}

interface Directory {
  readonly path: string;
  readonly name: string;
  readonly directories: Map<string, Directory>;
  readonly files: ContentSidebarItem[];
}

function DirectoryLinks({ items, root, query, onNavigate }: { items: readonly ContentSidebarItem[]; root: string; query: string; onNavigate(): void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const active = items.find(item => item.active)?.id;
  useEffect(() => {
    if (!active) return;
    const parts = active.slice(root.length).split('/');
    setExpanded(previous => {
      const next = { ...previous };
      for (let length = 1; length < parts.length; length++) next[root + parts.slice(0, length).join('/')] = true;
      return next;
    });
  }, [active, root]);
  const tree: Directory = { path: root, name: '', directories: new Map(), files: [] };
  for (const item of items) {
    const parts = item.id.slice(root.length).split('/');
    let directory = tree;
    for (const name of parts.slice(0, -1)) {
      const path = `${directory.path.replace(/\/$/u, '')}/${name}`;
      let child = directory.directories.get(name);
      if (!child) { child = { path, name, directories: new Map(), files: [] }; directory.directories.set(name, child); }
      directory = child;
    }
    directory.files.push(item);
  }
  const render = (directory: Directory): ReactNode => <>
    {[...directory.directories.values()].sort((a, b) => a.name.localeCompare(b.name)).map(child => {
      const open = Boolean(query.trim()) || (expanded[child.path] ?? Boolean(active?.startsWith(`${child.path}/`)));
      return <li key={child.path}><button type="button" className="document-navigation__folder" aria-expanded={open} title={child.path} onClick={() => setExpanded(previous => ({ ...previous, [child.path]: !open }))}><ChevronRight size={14} className={open ? 'rotate-90' : undefined} /><Folder size={16} /><span>{child.name}</span></button>
        {open && <ul className="document-navigation__branch">{render(child)}</ul>}
      </li>;
    })}
    {[...directory.files].sort((a, b) => a.id.split('/').at(-1)!.localeCompare(b.id.split('/').at(-1)!)).map(item => <li key={item.id}><SidebarItem item={item} label={item.id.split('/').at(-1)} tooltip={item.id} onNavigate={onNavigate} /></li>)}
  </>;
  return render(tree);
}

/** Pages own the navigation model; this component owns layout and mobile presentation. */
export function ContentSidebar({ model, actions }: { model: ContentSidebarModel; actions?: ReactNode }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const query = model.filter?.value ?? localQuery;
  const setQuery = model.filter?.onChange ?? setLocalQuery;
  const slot = (value: SidebarSlot) => typeof value === 'function' ? value(() => setOpen(false)) : value;
  const content = <nav aria-label="内容导航" className="document-navigation__content">
    <div className="document-navigation__header">
      {model.back && <Link className="document-navigation__back" to={model.back.href} onClick={() => setOpen(false)}><ArrowLeft size={16} />{model.back.title}</Link>}
      <strong>{model.title}</strong>
      {!isMobile && actions}
    </div>
    {model.filter && <Input className="mb-3" aria-label={model.filter.label} placeholder={model.filter.placeholder} value={query} onChange={event => setQuery(event.target.value)} />}
    {model.groups.map((group, index) => {
      const items = group.items.filter(item => !model.filter || group.filterable === false || `${item.title} ${item.id} ${item.searchText ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return <section key={group.id} className={index ? 'document-navigation__section' : undefined}>
      {group.heading && <h2>{group.heading}</h2>}
      {slot(group.actions)}
      {group.content ? slot(group.content) : <ul aria-label={group.label}>{group.treeRoot ? <DirectoryLinks items={items} root={group.treeRoot} query={query} onNavigate={() => setOpen(false)} /> : items.map(item => <li key={item.id}>
        <SidebarItem item={item} onNavigate={() => setOpen(false)} />
      </li>)}</ul>}
      {!group.content && items.length === 0 && <p className="muted">{query && group.filterable !== false ? "没有匹配项" : group.emptyMessage}</p>}
      {slot(group.footer)}
    </section>; })}
  </nav>;
  return isMobile ? <div className="document-navigation-mobile"><Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="outline"><List />内容导航</Button></SheetTrigger>
    <SheetContent side="left" className="document-navigation-sheet" aria-describedby={undefined}><SheetHeader><SheetTitle>{model.label} 导航</SheetTitle></SheetHeader>{content}</SheetContent>
  </Sheet>{actions}</div> : <aside className="document-navigation" aria-label={`${model.label} 侧栏`}>{content}</aside>;
}
