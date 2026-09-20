import { ArrowLeft, List } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useIsMobile } from '../hooks/use-mobile';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

export interface ContentSidebarItem {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly active?: boolean;
  readonly icon?: ReactNode;
}
export interface ContentSidebarGroup {
  readonly id: string;
  readonly label: string;
  readonly heading?: string;
  readonly items: readonly ContentSidebarItem[];
  readonly emptyMessage?: string;
}
export interface ContentSidebarModel {
  readonly label: string;
  readonly title: string;
  readonly back?: { readonly title: string; readonly href: string };
  readonly groups: readonly ContentSidebarGroup[];
  readonly filter?: { readonly label: string; readonly placeholder: string };
}

/** Pages own the navigation model; this component owns layout and mobile presentation. */
export function ContentSidebar({ model, actions }: { model: ContentSidebarModel; actions?: ReactNode }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const content = <nav aria-label="内容导航" className="document-navigation__content">
    <div className="document-navigation__header">
      {model.back && <Link className="document-navigation__back" to={model.back.href} onClick={() => setOpen(false)}><ArrowLeft size={16} />{model.back.title}</Link>}
      <strong>{model.title}</strong>
      {!isMobile && actions}
    </div>
    {model.filter && <Input className="mb-3" aria-label={model.filter.label} placeholder={model.filter.placeholder} value={query} onChange={event => setQuery(event.target.value)} />}
    {model.groups.map((group, index) => {
      const items = group.items.filter(item => !model.filter || `${item.title} ${item.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return <section key={group.id} className={index ? 'document-navigation__section' : undefined}>
      {group.heading && <h2>{group.heading}</h2>}
      <ul aria-label={group.label}>{items.map(item => <li key={item.id}>
        <Link to={item.href} title={item.title} aria-current={item.active ? 'page' : undefined} onClick={() => setOpen(false)}>{item.icon}<span>{item.title}</span></Link>
      </li>)}</ul>
      {items.length === 0 && <p className="muted">{query ? "没有匹配项" : group.emptyMessage}</p>}
    </section>; })}
  </nav>;
  return isMobile ? <div className="document-navigation-mobile"><Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild><Button variant="outline"><List />内容导航</Button></SheetTrigger>
    <SheetContent side="left" className="document-navigation-sheet" aria-describedby={undefined}><SheetHeader><SheetTitle>{model.label} 导航</SheetTitle></SheetHeader>{content}</SheetContent>
  </Sheet>{actions}</div> : <aside className="document-navigation" aria-label={`${model.label} 侧栏`}>{content}</aside>;
}
