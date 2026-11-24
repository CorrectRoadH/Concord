type Phase =
  | 'idle' | 'running' | 'verified' | 'notify'
  | 'failed' | 'delivered' | 'suppressed' | 'scheduled'
  | 'finished' | 'exhausted';

type ModelState = {
  readonly trigger: 'none' | 'tag' | 'manual';
  readonly attempt: 0 | 1 | 2;
  readonly phase: Phase;
  readonly checks: boolean;
  readonly packaged: boolean;
  readonly receipt: 'none' | 'requested' | 'received';
};

export const title = '标签发版的失败重试与渠道回执';

export function state(value: ModelState): string {
  switch (value.phase) {
    case 'idle': return '等待调度发版';
    case 'running': return value.attempt === 1 ? '首次发版运行中' : '正在重跑失败任务';
    case 'verified': return '标签提交已通过检查和打包';
    case 'notify': return '源码资产已就位，正在核对渠道';
    case 'failed': return '首次失败，等待安排重试';
    case 'delivered': return '重试工作流收到完成事件';
    case 'suppressed': return '标签发版的完成事件未送达';
    case 'scheduled': return '已安排一次失败任务重试';
    case 'finished':
      return value.receipt === 'received' ? '渠道完成回执已存在' : '已请求渠道同步，回执待补';
    case 'exhausted': return '重试失败，自动重试已用尽';
  }
}

const labels: Readonly<Partial<Record<string, string>>> = {
  PublishNewAsset: '上传经过核验的源码资产',
  ReuseExistingAsset: '复用身份和摘要一致的资产',
  RejectExistingAsset: '已有资产身份或摘要冲突，停止发版',
  RequestChannelSync: '请求渠道同步',
  FailChannelNotification: '通知失败，已上传资产保留',
  ReceiveChannelReceipt: '渠道独立写入完成回执',
  RecognizeChannelReceipt: '确认已有渠道完成回执',
  StartRetry: '重跑失败任务，保留成功结果',
  Done: '本次发版处理结束',
};

export function step(action: string, from: ModelState, to: ModelState): string | null {
  switch (action) {
    case 'DispatchRelease': return '调度默认分支的 Release [检出显式标签]';
    case 'FinishChecksAndPackaging': return to.checks && to.packaged ? '同一标签提交的检查和打包成功' : '检查或打包失败';
    case 'ResolveCompletion': return from.trigger === 'tag' ? '默认令牌调度抑制完成事件' : '平台交付手动发版的完成事件';
    case 'ScheduleRetry': return from.trigger === 'tag' ? '分派器按运行 ID 安排重试' : '订阅者安排重试';
    default: return labels[action] ?? null;
  }
}

export const colors = {
  调度: 'blue',
  核验: 'purple',
  重试: 'orange',
  发布: 'teal',
};

const groups: Readonly<Record<Phase, keyof typeof colors>> = {
  idle: '调度',
  running: '核验',
  verified: '核验',
  notify: '发布',
  failed: '重试',
  delivered: '重试',
  suppressed: '重试',
  scheduled: '重试',
  finished: '发布',
  exhausted: '重试',
};

export function group(value: ModelState): keyof typeof colors {
  return groups[value.phase];
}
