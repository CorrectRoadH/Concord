type ModelState = {
  readonly generation: number;
  readonly registered: number;
  readonly listening: readonly number[];
  readonly refs: Readonly<Record<number, readonly string[]>>;
  readonly browser: number;
  readonly cleanup: readonly number[];
  readonly expired: boolean;
};

export const title = 'HTTP 监听引用与浏览器 SSE';

const labels = {
  duplicate: '同一请求地址有多个监听',
  orphaned: '监听记录丢失，仍可请求重新开启',
  orphanedAtBound: '监听记录丢失，已到模型重开上限',
  closed: '监听已关闭',
  closedPending: '已关闭，旧连接清理待执行',
  reopened: '已重新监听，旧连接清理待执行',
  sharedWithBrowser: '有引用和浏览器连接',
  browserOnly: '仅浏览器连接仍在',
  view: '至少一个 view 引用仍在',
  panelIdle: '面板引用仍在空闲期',
  panelExpired: '面板引用已满空闲期限',
  waitingForClose: '浏览器已断开，等待关闭',
};

function status(value: ModelState): keyof typeof labels {
  if (value.listening.length > 1) return 'duplicate';
  if (value.registered === 0) {
    if (value.listening.length > 0) {
      return value.generation === Object.keys(value.refs).length
        ? 'orphanedAtBound'
        : 'orphaned';
    }
    return value.cleanup.length > 0 ? 'closedPending' : 'closed';
  }
  const refs = value.refs[value.registered] ?? [];
  if (refs.length > 0 && value.cleanup.some(generation => generation !== value.registered)) return 'reopened';
  if (value.browser === value.registered) return refs.length > 0 ? 'sharedWithBrowser' : 'browserOnly';
  if (refs.some(reference => reference !== 'panel')) return 'view';
  if (refs.includes('panel')) return value.expired ? 'panelExpired' : 'panelIdle';
  return 'waitingForClose';
}

export function state(value: ModelState): string {
  return labels[status(value)];
}

export const colors = { 监听: 'teal', 等待: 'orange', 关闭: 'tan' };

export function group(value: ModelState): keyof typeof colors {
  if (value.registered === 0) return '关闭';
  if (value.browser === value.registered || status(value) === 'reopened' || status(value) === 'view') return '监听';
  return '等待';
}

export function step(action: string, from: ModelState, to: ModelState): string | null {
  const before = status(from);
  const after = status(to);
  switch (action) {
    case 'Open':
    case 'OpenView':
    case 'OpenPanel':
      return from.registered === 0 ? '请求开启监听' : null;
    case 'DisconnectView':
    case 'ReleaseReference':
      if (before === 'view' && after === 'panelExpired') return null;
      if ((before === 'panelIdle' || before === 'panelExpired' || before === 'reopened') && after === 'closedPending') return null;
      if (before === 'reopened' && after === 'browserOnly') return null;
      return '释放引用';
    case 'ConnectSse': return before === 'waitingForClose' ? null : '浏览器连接';
    case 'EndSse': return '浏览器断开';
    case 'ElapseIdle': return '连续十分钟没有浏览器连接';
    case 'Tick':
      if ((before === 'panelExpired' || before === 'reopened') && after === 'closedPending') return null;
      return '定时检查释放空闲监听';
    case 'FinishSseCleanup':
      if (to.registered === 0 && to.listening.length > 0) return '旧连接清理删除当前监听记录';
      if (before === 'reopened' && (after === 'panelExpired' || after === 'sharedWithBrowser')) return null;
      return from.registered === to.registered ? '丢弃旧连接清理' : '连接清理关闭监听';
    default: return null;
  }
}
