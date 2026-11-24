const stages = {
  idle: '槽位空闲',
  running: '收集或分析正在运行',
  'leader-closed': '等待确认进程组已清理',
  cancelled: '等待确认进程组已清理',
  'timed-out': '等待确认进程组已清理',
  'service-stopping': '等待确认进程组已清理',
  ready: '等待核对观察输入',
  published: '本次观察已发布',
  stale: '输入已变，未发布本次观察',
  aborted: '观察已中止，进程组已清理',
};

type ModelState = {
  readonly run: {
    readonly stage: keyof typeof stages | 'blocked';
    readonly ownerAlive: boolean;
  };
};

export const title = '外部观察槽位与清理恢复';

export function state({ run }: ModelState): string {
  if (run.stage === 'blocked') {
    return run.ownerAlive ? '清理阻断，占用者仍存活' : '清理阻断，占用者已死亡';
  }
  return stages[run.stage];
}

const steps = {
  StartObservation: '启动收集或分析，占用槽位',
  CleanupUnconfirmed: '无法确认已清理，保留占用',
  OwnerDies: '占用者死亡，保留占用',
  VerifyAndPublishCurrent: '来源与观察输入一致，发布结果',
  RejectChangedInputs: '复核发现来源已变，丢弃本次结果',
  ReleaseCleanSlot: '释放槽位',
  ManualRelease: '用户确认清理，以当前同主机 token 解除',
};

const cleanupSteps = {
  'leader-closed': '主进程退出，开始收尾',
  cancelled: '收到取消，终止进程组',
  'timed-out': '观察超时，终止进程组',
  'service-stopping': '服务停止，终止进程组',
};

export function step(action: string, _from: ModelState, to: ModelState): string | null {
  if (action === 'BeginCleanup') {
    return Object.entries(cleanupSteps).find(([stage]) => stage === to.run.stage)?.[1] ?? null;
  }
  if (action === 'ConfirmGroupGone') {
    return to.run.stage === 'ready'
      ? '确认进程组已清理 [主进程正常结束]'
      : '确认进程组已清理 [已请求终止]';
  }
  return Object.entries(steps).find(([name]) => name === action)?.[1] ?? null;
}

export const colors = {
  收尾: 'orange',
  阻断: 'pink',
  发布: 'teal',
};

export function group({ run }: ModelState): keyof typeof colors | undefined {
  switch (run.stage) {
    case 'blocked': return '阻断';
    case 'published': return '发布';
    case 'leader-closed':
    case 'cancelled':
    case 'timed-out':
    case 'service-stopping':
    case 'ready':
    case 'stale':
    case 'aborted': return '收尾';
    default: return undefined;
  }
}
