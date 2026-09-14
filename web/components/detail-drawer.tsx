import type { ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';

export interface DetailDrawerModel {
  readonly title: string;
  readonly description: string;
}

/** Controlled by the page so route changes and dirty-draft guards stay with their owner. */
export function DetailDrawer({ model, open, onClose, children }: {
  model: DetailDrawerModel;
  open: boolean;
  onClose(): void;
  children: ReactNode;
}) {
  return <Sheet open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <SheetContent side="right" className="detail-drawer w-full sm:max-w-none">
      <SheetHeader><SheetTitle>{model.title}</SheetTitle><SheetDescription>{model.description}</SheetDescription></SheetHeader>
      <div className="detail-drawer__body">{children}</div>
    </SheetContent>
  </Sheet>;
}
