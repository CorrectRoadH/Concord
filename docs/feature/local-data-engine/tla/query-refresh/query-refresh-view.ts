type Envelope = {
  readonly record: 'none' | 'consistent' | 'inconsistent';
};

type Decision = {
  readonly kind: 'none' | 'consistent' | 'inconsistent' | 'unstructured' | 'failure' | 'discarded' | 'expired';
  readonly before: Envelope;
};

type ModelState = {
  readonly scan: { readonly phase: 'idle' | 'queued' | 'scanning' | 'candidate' | 'retry' | 'finished' };
  readonly decision: Decision;
};

export const title = '历史诊断投影的后台刷新';

export function state({ scan, decision }: ModelState): string {
  switch (scan.phase) {
    case 'idle': return '尚未请求刷新';
    case 'queued':
      if (decision.kind === 'discarded') return '等待按新身份刷新';
      return decision.kind === 'none' ? '刷新待开始' : '后续刷新待开始';
    case 'scanning': return '正在扫描';
    case 'candidate': return '扫描已结束，等待入库';
    case 'retry': return '缓存占用，等待重试';
    case 'finished':
      switch (decision.kind) {
        case 'consistent': return '一致投影已发布';
        case 'inconsistent':
          return decision.before.record === 'consistent' ? '保留一致投影，记录漂移' : '带漂移标记的投影已发布';
        case 'unstructured': return '只记录不完整的尝试';
        case 'failure': return '保留原结果和尝试，记录错误';
        case 'expired': return '超过入库期限，缓存保持原样';
        case 'none':
        case 'discarded': throw new Error('An ended refresh must have a publication decision');
      }
  }
}

export function step(action: string, _from: ModelState, to: ModelState): string | null {
  switch (action) {
    case 'RequestRefresh': return '请求后台刷新';
    case 'StartScan': return '开始扫描，合并已到达的请求';
    case 'FinishScan': return '扫描结束';
    case 'CancelBackground': return '后台刷新被取消';
    case 'DiscardChangedIdentity': return '身份键变化，放弃本次刷新';
    case 'WaitForCache': return '缓存占用，本次入库暂停';
    case 'ExpireCacheRetry': return '缓存仍被占用，结束本次刷新';
    case 'Publish':
      switch (to.decision.kind) {
        case 'consistent': return '发布一致投影';
        case 'inconsistent':
          return to.decision.before.record === 'consistent' ? '仅更新尝试记录' : '发布并标记来源漂移';
        case 'unstructured': return '更新不完整的尝试记录';
        case 'failure': return '记录刷新错误';
        case 'none':
        case 'discarded':
        case 'expired': throw new Error('Publication must have a scan outcome');
      }
    default: return null;
  }
}

export function group({ scan, decision }: ModelState): string {
  switch (scan.phase) {
    case 'idle':
    case 'queued': return '等待';
    case 'scanning':
    case 'candidate': return '刷新';
    case 'retry': return '重试';
    case 'finished':
      return decision.kind === 'failure' || decision.kind === 'expired' ? '错误' : '完成';
  }
}

export const colors = {
  等待: 'purple',
  刷新: 'blue',
  重试: 'yellow',
  完成: 'teal',
  错误: 'orange',
};
