type Repository = 'A' | 'B';
type Session = {
  readonly open: boolean;
  readonly saved: number;
  readonly pending: number;
  readonly running: readonly number[];
  readonly report: { readonly status: 'none' | 'findings' | 'check failed' | 'passed' };
};
type ModelState = {
  readonly sessions: Readonly<Record<Repository, Session>>;
  readonly projectionReading: boolean;
};

export const title = 'Herdr 保存后的后台检查';

export function state({ sessions: { A: session }, projectionReading }: ModelState): string {
  if (!session.open) return '仓库会话已关闭';
  if (session.saved === 0) return projectionReading ? '尚未保存，后台读取仓库' : '尚未保存';
  if (session.running.length > 0) return session.pending > 0 ? '旧检查仍在运行，等待检查最新保存' : '已保存，正在检查';
  if (session.pending > 0) return '已保存，等待开始检查';
  switch (session.report.status) {
    case 'findings': return '已保存，显示检查问题';
    case 'check failed': return '已保存，检查失败';
    case 'passed': return '旧投影把新保存标成通过';
    case 'none': return '已保存';
  }
}

export function step(action: string, _from: ModelState, { sessions: { A: session } }: ModelState): string | null {
  switch (action) {
    case 'SaveConfirmed': return '文件写入并读回确认';
    case 'StartCheck': return '开始检查最新保存';
    case 'FinishCheck':
      if (session.pending > 0) return '旧检查返回，丢弃结论';
      return session.report.status === 'check failed' ? '检查执行失败' : '检查返回问题';
    case 'ReadProjection': return '开始后台读取仓库';
    case 'ReceiveProjection': return session.report.status === 'passed' ? '旧投影返回并覆盖检查结论' : '后台读取返回';
    case 'SwitchRepository': return '切换仓库，中止后台读取';
    case 'EvictSession':
    case 'CloseMod': return '仓库会话淘汰或关闭 mod';
    default: return null;
  }
}

export const colors = { 等待检查: 'orange', 正在检查: 'blue', 检查已完成: 'teal', 检查失败: 'pink', 会话关闭: 'tan' };

export function group({ sessions: { A: session } }: ModelState): keyof typeof colors | undefined {
  if (!session.open) return '会话关闭';
  if (session.running.length > 0) return '正在检查';
  if (session.pending > 0) return '等待检查';
  if (session.report.status === 'findings') return '检查已完成';
  if (session.report.status === 'check failed') return '检查失败';
}
