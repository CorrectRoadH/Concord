// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import type { WorkspaceSnapshot } from '../../src/view-contract';
import { Button } from './ui/button';

export function WorkspaceHealthNotice({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const signature = JSON.stringify([snapshot.root, snapshot.findings]);
  useEffect(() => { if (snapshot.complete !== false) setDismissed(null); }, [snapshot.complete]);
  if (snapshot.complete !== false || dismissed === signature) return null;
  return <div role="alert" className="flex items-center justify-between gap-3 text-amber-700">
    <Link className="underline underline-offset-4" to="/#workspace-health">工作区扫描不完整，列表和关联可能缺失。查看工作区健康</Link>
    <Button variant="ghost" size="icon" aria-label="关闭工作区健康提示" onClick={() => setDismissed(signature)}><X /></Button>
  </div>;
}
