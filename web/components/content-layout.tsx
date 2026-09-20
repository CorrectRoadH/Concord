import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/utils';

export function PanelHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return <header className="panel-header"><h2>{title}</h2>{actions && <div className="button-row">{actions}</div>}</header>;
}

export function ContentSection({ title, summary, children, ...props }: Omit<ComponentProps<'section'>, 'title'> & { title: ReactNode; summary?: ReactNode }) {
  return <section {...props} className={cn('content-section', props.className)}><div className="content-section__heading"><h3>{title}</h3>{summary && <span>{summary}</span>}</div>{children}</section>;
}

export function RecordList(props: ComponentProps<'ul'>) {
  return <ul {...props} className={cn('content-records', props.className)} />;
}

export function PanelEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="panel-empty"><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function RecordItem(props: ComponentProps<'li'>) {
  return <li {...props} className={cn('content-record', props.className)} />;
}

export function RecordDetails({ children, title = '声明详情' }: { children: ReactNode; title?: string }) {
  return <details className="content-record__details"><summary>{title}</summary><div>{children}</div></details>;
}

export function Surface(props: ComponentProps<'div'>) {
  return <div {...props} className={cn('content-surface', props.className)} />;
}
