const phases = {
  draining: '旧实例排空请求和子进程',
  'closing-cache': '旧实例关闭持久缓存',
  resources: '旧实例清理剩余资源',
  released: '等待确认旧进程退出且服务锁释放',
  exited: '等待确认旧进程退出且服务锁释放',
};

type ModelState = {
  readonly active: 0 | 1 | 2;
  readonly command: Readonly<Record<1 | 2, { readonly stage: string }>>;
  readonly instance: 'Old' | 'New' | 'Rival';
  readonly phase: keyof typeof phases | 'launching' | 'locked' | 'opening' | 'running';
  readonly hung: boolean;
};

const activeStage = ({ active, command }: ModelState) => active === 0 ? 'idle' : command[active].stage;
const mismatch = '服务由不同安装的实例占用';

export const title = '工作区服务替换与退出';

export function state(value: ModelState): string {
  const stage = activeStage(value);
  switch (stage) {
    case 'CleanupFailed':
      if (value.hung) return value.active === 1 ? '第一条命令返回 CleanupFailed' : '第二条命令也返回 CleanupFailed';
      break;
    case 'WorkspaceServerBusy': return '另一安装占用服务（WorkspaceServerBusy）';
    case 'served': return '当前安装已处理请求';
    case 'mismatch':
      if (value.phase === 'running') return mismatch;
      break;
    case 'can-start':
      if (value.phase === 'exited') return '已确认进程退出并试取服务锁';
      break;
  }
  if (value.hung) {
    if (value.active === 1) return '旧实例退出流程挂起';
    return stage === 'discovering' ? '第二条命令发现旧实例挂起' : '第二条命令等待旧实例退出';
  }
  if (value.instance === 'New') return '通过当前安装的服务提交请求';
  switch (value.phase) {
    case 'draining':
    case 'closing-cache':
    case 'resources':
    case 'released':
    case 'exited': return phases[value.phase];
    default:
      if (value.instance === 'Rival') return mismatch;
      return value.active === 0 ? '旧安装正在运行' : '当前命令检查旧实例';
  }
}

const steps = {
  InvokeCommand: '发起下一条需要服务的命令',
  IncompatibleHello: '握手并核对运行记录',
  ShutdownWithToken: '按实例 token 请求退出',
  WaitForStoppingInstance: '等待正在退出的实例',
  DrainRequests: '完成在途工作和子进程清理',
  CloseCache: '确认持久缓存已关闭',
  ReleaseResources: '清理记录和 socket，释放服务锁',
  ProcessExits: '进程退出',
  PauseOldCleanup: '退出流程挂起',
  ExternalSigkill: '外部 SIGKILL，系统释放服务锁，运行记录残留',
  ExitWaitTimesOut: '等待 10 秒后报告清理阶段',
  ProbeReleasedLock: '确认进程已退出，试取并释放服务锁',
  RivalWinsLock: '另一安装抢先取得服务锁',
  ReplacementBudgetSpent: '本命令已发起一次替换',
  StartCurrent: '启动当前安装的服务',
  AcquireCurrentLock: '新实例取得服务锁',
  PublishCurrentRecord: '新实例发布运行记录',
  OpenCurrentCache: '新实例打开持久缓存',
  CurrentHello: '握手确认当前安装和实例 token',
  ServeRequest: '完成握手后处理本次业务请求',
  Done: '两条命令结束',
};

export function step(action: string, from: ModelState): string | null {
  if (action === 'ExternalSigkill' && (activeStage(from) !== 'CleanupFailed' || from.phase === 'released')) return null;
  if (action === 'PauseOldCleanup') {
    if (from.phase === 'draining' || from.phase === 'released') return null;
    if (from.phase === 'resources') return '剩余资源清理挂起，服务锁仍被持有';
  }
  return Object.entries(steps).find(([name]) => name === action)?.[1] ?? action;
}

export const colors = {
  清理: 'orange',
  当前安装: 'teal',
  阻断: 'pink',
};

export function group(value: ModelState): keyof typeof colors | undefined {
  const stage = activeStage(value);
  if (value.hung || stage === 'WorkspaceServerBusy') return '阻断';
  if (value.instance === 'New') return '当前安装';
  if (value.phase !== 'running') return '清理';
  return undefined;
}
