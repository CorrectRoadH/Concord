import { useState } from 'react';
import { useWorkspace } from '../workspace';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

/** Guards tab and file changes which do not pass through React Router. */
export function useDraftNavigation(change: (value: string) => void) {
  const { dirty, flushAutoSave } = useWorkspace();
  const [pending, setPending] = useState<string | null>(null);
  const request = (value: string) => { if (!dirty) { change(value); return; } void flushAutoSave().then(saved => { if (saved) change(value); else setPending(value); }); };
  const dialog = <Dialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }}>
    <DialogContent><DialogHeader><DialogTitle>切换并丢弃未保存内容？</DialogTitle><DialogDescription>当前草稿尚未保存。你可以留下继续编辑，或明确丢弃后切换。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setPending(null)}>继续编辑</Button><Button variant="destructive" onClick={() => { if (pending !== null) change(pending); setPending(null); }}>丢弃并切换</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
  return { request, dialog };
}
