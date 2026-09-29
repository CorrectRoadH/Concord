// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { useWorkspace } from '../workspace';
import { Button } from './ui/button';

/** Unknown, drifted or incomplete navigation is announced; it is never called healthy. */
export function WorkspaceHealthNotice() {
  const { projection } = useWorkspace();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const reasons: string[] = [];
  if (projection.consistent === false) reasons.push('构建期间来源发生变化，导航可能滞后');
  if (projection.complete === false) reasons.push('工作区扫描不完整，列表和关联可能缺失');
  if (projection.unknownRelations) reasons.push('部分关系未知');
  if (projection.status === 'refresh-failed') reasons.push('最近刷新失败，当前来源状态未知');
  if (projection.status === 'blocked') reasons.push('刷新被恢复状态阻断，当前来源状态未知');
  const signature = JSON.stringify([projection.status, projection.builtAt, projection.consistent, projection.complete, projection.unknownRelations, projection.changedPaths]);
  useEffect(() => { if (reasons.length === 0) setDismissed(null); }, [reasons.length]);
  if (reasons.length === 0 || dismissed === signature) return null;
  const changed = projection.changedPaths ?? [];
  return <div role="alert" className="flex items-start justify-between gap-3 text-amber-700">
    <div>
      <Link className="underline underline-offset-4" to="/#workspace-health">{reasons.join('；')}。查看工作区健康</Link>
      {changed.length > 0 && <p className="muted">变化路径：{changed.slice(0, 6).join('、')}{changed.length > 6 ? ` 等 ${changed.length} 项` : ''}</p>}
    </div>
    <Button variant="ghost" size="icon" aria-label="关闭工作区健康提示" onClick={() => setDismissed(signature)}><X /></Button>
  </div>;
}
