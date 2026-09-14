import type { ReactNode } from 'react';
import { SearchX } from 'lucide-react';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header__actions">{actions}</div>}</header>;
}
export function Empty({ title = '这里还没有内容', children }: { title?: string; children?: ReactNode }) {
  return <div className="empty"><SearchX size={28} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="field"><div className="field__label">{label}</div>{children}{hint && <div className="field__hint">{hint}</div>}</div>;
}
export function Definition({ label, children }: { label: string; children: ReactNode }) { return <div className="definition"><dt>{label}</dt><dd>{children}</dd></div>; }
