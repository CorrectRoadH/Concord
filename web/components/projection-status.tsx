// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { RefreshCw, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '../workspace';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

function time(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString();
}

/** Build time and refresh state of the served structural projection. */
export function ProjectionStatus() {
  const { projection, workspaceIssue, refreshIssue, navigationUpdating, requestRefresh, act, busy } = useWorkspace();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => { setRetrying(true); try { await requestRefresh(); } finally { setRetrying(false); } };
  const recover = async () => { setRetrying(true); try { await act({ action: 'recover' }, '恢复已执行，正在重新构建。'); } catch { /* Provider reports the named failure. */ } finally { setRetrying(false); } };
  const built = time(projection.builtAt);
  const range = projection.builtFrom && projection.builtUntil ? `${projection.builtFrom} – ${projection.builtUntil}` : undefined;
  if (workspaceIssue) return <div className="projection-status" role="status" aria-label="工作区投影状态">
    <Badge variant="destructive">工作区读取失败</Badge>
    <span title={workspaceIssue.message}>{workspaceIssue.code}</span>
    <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}><RefreshCw />重试</Button>
  </div>;
  if (refreshIssue) return <div className="projection-status" role="status" aria-label="工作区刷新请求状态">
    <Badge variant="destructive">{refreshIssue.code === 'CleanupFailed' ? 'View 清理失败' : '刷新请求失败'}</Badge>
    <span title={refreshIssue.message}>{refreshIssue.code}</span>
    {refreshIssue.code === 'CleanupFailed'
      ? <span>请重启 View，以便租约恢复协议回收现场。</span>
      : <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}><RefreshCw />重试刷新</Button>}
  </div>;
  if (projection.status === 'blocked') {
    const recoveryRequired = projection.lastError?.code === 'RecoveryRequired';
    const cleanupFailed = projection.lastError?.code === 'CleanupFailed';
    return <div className="projection-status" aria-label="工作区投影状态">
      <Badge variant="destructive">刷新被阻断</Badge>
      <span>{projection.lastError?.code ?? 'RecoveryRequired'}</span>
      {recoveryRequired
        ? <Button variant="outline" size="sm" disabled={busy || retrying} onClick={() => void recover()}><Wrench />恢复</Button>
        : cleanupFailed
          ? <span>请重启 View，以便租约恢复协议回收现场。</span>
          : <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}><RefreshCw />重试刷新</Button>}
    </div>;
  }
  if (projection.status === 'refresh-failed') {
    return <div className="projection-status" aria-label="工作区投影状态" title={range}>
      <Badge variant="outline">刷新失败</Badge>
      {built && <span>构建于 {built}</span>}
      <Button variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}><RefreshCw />重试刷新</Button>
    </div>;
  }
  return <div className="projection-status" aria-label="工作区投影状态" title={range}>
    {navigationUpdating ? <span className="projection-status__pending"><RefreshCw size={13} />导航更新中…</span> : built && <span>构建于 {built}</span>}
  </div>;
}
