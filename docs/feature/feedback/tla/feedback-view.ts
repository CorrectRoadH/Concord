type Phase = 'idle' | 'reading' | 'ready' | 'rejected' | 'published' | 'merged' | 'conflict' | 'cache-failed';

type ModelState = {
  readonly requests: Record<'A' | 'B', { readonly phase: Phase }>;
  readonly issues: readonly string[];
  readonly cache: { readonly time: number };
};

export const title = '反馈导入与观察缓存';

const states = {
  idle: '还未请求远端反馈',
  reading: '读取远端反馈，等待发布',
  readingBoth: '两个请求分别读取远端反馈',
  rejected: '配置已变，拒绝发布',
  published: '来源已发布，等待更新观察缓存',
  publishedBoth: '两个请求均已完成来源发布，等待更新观察缓存',
  mergedOne: '观察缓存已有结果，另一请求等待合并',
  merged: '来源已发布，观察缓存可用',
  conflict: '保留同时间戳的观察，返回冲突提示',
  'cache-failed': '更新观察缓存失败，返回来源完成回执',
};

export function state({ requests }: ModelState): string {
  const phases = [requests.A.phase, requests.B.phase];
  if (phases.includes('cache-failed')) return states['cache-failed'];
  if (phases.includes('conflict')) return states.conflict;
  if (phases.every(phase => phase === 'published')) return states.publishedBoth;
  if (phases.includes('published')) return phases.includes('merged') ? states.mergedOne : states.published;
  if (phases.includes('merged')) return states.merged;
  if (phases.includes('rejected')) return states.rejected;
  const activeReads = phases.filter(phase => phase === 'reading' || phase === 'ready').length;
  return activeReads === 2 ? states.readingBoth : activeReads === 1 ? states.reading : states.idle;
}

export function step(action: string, from: ModelState, to: ModelState): string | null {
  switch (action) {
    case 'StartRead': return '读取连接配置并发起远端读取';
    case 'ReadComplete': return '收到合格的远端反馈';
    case 'EditConfig': return '读取期间修改配置';
    case 'RejectChangedConfig': return '复核发现配置已变';
    case 'Publish':
      return from.issues.length === 0 ? '发布本地 Issue，首次绑定时同批发布' : '复用已有 Issue，按需绑定连接';
    case 'MergeObservation':
      if (state(to) === states.conflict) return '同一时间戳出现不同内容';
      return from.cache.time === 0 ? '写入远端观察' : '按时间戳保留最新观察';
    case 'CacheUpdateFails': return '保留来源发布并报告缓存失败';
    case 'Done': return '请求结束';
    default: return null;
  }
}

export const colors = { 读取: 'yellow', 来源发布: 'teal', 冲突: 'orange', 失败: 'pink' };

export function group(values: ModelState): keyof typeof colors | undefined {
  switch (state(values)) {
    case states.reading:
    case states.readingBoth: return '读取';
    case states.published:
    case states.publishedBoth:
    case states.mergedOne:
    case states.merged: return '来源发布';
    case states.conflict: return '冲突';
    case states.rejected:
    case states['cache-failed']: return '失败';
    default: return undefined;
  }
}
