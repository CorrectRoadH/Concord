const phases = {
  serving: '缓存正在服务',
  opening: '打开缓存并检查格式',
  draining: '停止准入，等待原生调用返回',
  closing: '等待关闭旧数据库句柄',
  root: '等待取得根引擎锁',
  child: '已锁住根，等待子锁',
  verify: '已取得全部引擎锁，核对缓存树',
  delete: '核对通过，可以删除缓存数据',
  deleted: '缓存数据已删除，锁文件保留',
  reopen: '已释放清理锁，等待重开',
  ready: '缓存可用',
};

type ModelState = {
  readonly attempt: {
    readonly phase: keyof typeof phases | 'failed';
    readonly outcome: 'pending' | 'ok' | 'HawdbBusy' | 'HawdbIncompatible' | 'CleanupFailed' | 'UnsafePath';
    readonly reopenBusy: boolean;
  };
  readonly pinChanged: boolean;
};

export const title = 'HawDB 缓存清理与重开';

export const state = ({ attempt, pinChanged }: ModelState) => {
  if (attempt.phase === 'root' && pinChanged) return '失活 root-pin 已更新，等待取得根引擎锁';
  if (attempt.phase !== 'failed') return phases[attempt.phase];
  if (attempt.reopenBusy) return '重开遇到占用，报告 HawdbBusy';
  switch (attempt.outcome) {
    case 'HawdbBusy': return '外部占用，报告 HawdbBusy';
    case 'HawdbIncompatible': return '格式未知，保留缓存并报告错误';
    case 'CleanupFailed': return '清理检查失败，报告 CleanupFailed';
    case 'UnsafePath': return '自动失效检查失败，报告 UnsafePath';
    case 'pending':
    case 'ok': throw new Error('A failed cache attempt has no failure code');
  }
};

const steps: Readonly<Record<string, string>> = {
  StartExplicitClear: '运行 cache clear',
  DrainComplete: '原生调用返回，排空完成',
  ConfirmObsoleteSchema: '确认旧格式，记下缓存树身份',
  OpenCurrentSchema: '确认格式有效',
  ReportUnknownSchema: '无法确认旧格式，结束打开',
  CloseOldHandle: '官方 close 完成',
  TakeRootLock: '取得根引擎锁',
  FailClearBusy: '外部持有引擎锁，结束清理',
  TakeChildLock: '取得剩余引擎锁',
  RefuseChangedInventory: '缓存树或锁身份变化，结束清理',
  RefuseStaleSchema: '缓存树或锁身份变化，结束清理',
  VerifyInventory: '核对持有的锁与缓存树',
  DeleteCacheData: '删除允许清理的数据',
  ReleaseClearLocks: '释放引擎清理锁',
  ReopenCache: '官方库成功重开',
  ReportBusyReopen: '外部抢先取得引擎锁，结束本次尝试',
};

export const step = (action: string) => steps[action] ?? null;

export const group = ({ attempt }: ModelState) => {
  switch (attempt.phase) {
    case 'serving':
    case 'ready': return '可用';
    case 'opening':
    case 'draining':
    case 'closing': return '排空与确认';
    case 'root':
    case 'child':
    case 'verify':
    case 'delete':
    case 'deleted': return '锁定与清理';
    case 'reopen': return '重开';
    case 'failed': return '失败';
  }
};

export const colors = {
  可用: 'teal',
  排空与确认: 'blue',
  锁定与清理: 'purple',
  重开: 'yellow',
  失败: 'orange',
};
