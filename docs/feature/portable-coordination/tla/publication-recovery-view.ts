type Reply = 'queued' | 'publishing' | 'SourceChanged' | 'applied' | 'interrupted';
type RecoveryStatus = 'none' | 'completed' | 'rolledBack' | 'discarded';

type ModelState = {
  readonly journal: { readonly phase: 'absent' | 'prepared' | 'committed'; readonly nextTarget: 1 | 2 | 3 };
  readonly server: 'running' | 'needs-recovery' | 'down' | 'recovering' | 'ready' | 'replied';
  readonly replies: Readonly<Record<string, Reply>>;
  readonly recovery: { readonly status: RecoveryStatus };
  readonly recoveryStep: 'idle' | 'inspect' | 'rollback';
  readonly recoveryCrashed: boolean;
};

export const title = '发布中断与外部编辑后的恢复';

const publicationLabels = {
  1: 'journal 已落盘，目标尚未替换',
  2: '第一个目标已替换',
  3: '所有目标已替换',
};

const recoveryLabels = {
  none: '等待恢复',
  completed: '保留完整计划内容，已清除 journal',
  rolledBack: '已还原完整前像并清除 journal',
  discarded: '已保留外部编辑，清除 journal 并告警',
};

export function state(value: ModelState): string {
  switch (value.server) {
    case 'needs-recovery': return '发布中断，journal 留在磁盘';
    case 'down':
      return value.recoveryCrashed ? '恢复再次中断，journal 留在磁盘' : '发布中断，journal 留在磁盘';
    case 'recovering':
      return value.recoveryStep === 'rollback' ? '正在还原写入前内容' : '正在检查磁盘上的目标';
    case 'ready': return recoveryLabels[value.recovery.status];
    case 'running':
    case 'replied': {
      if (value.journal.phase !== 'absent') return publicationLabels[value.journal.nextTarget];
      const replies = Object.values(value.replies);
      if (replies.includes('SourceChanged')) return '过期计划已被拒绝';
      if (replies.includes('applied')) return '发布已完成，journal 已清除';
      if (value.server === 'replied') return '恢复后已首次应答';
      return '两条写入基于同一前像排队';
    }
  }
}

const actionLabels: Readonly<Partial<Record<string, string>>> = {
  ReplaceTarget: '核对前像后原子替换一个目标',
  RecordCommit: '记录全部目标就位',
  FinishPublication: '记录提交后清除 journal 并确认发布成功',
  ExternalEdit: '编辑器直接改写目标',
  TargetChanged: '目标已变，停止发布',
  CrashRecovery: '恢复进程退出',
  StartRollback: '只有前像或计划内容，开始还原',
  RestoreTarget: '核对磁盘内容后还原一个目标',
  ReplyToBusiness: '处理第一条业务请求',
  Done: '两条写入都已结束',
};

export function step(action: string, from: ModelState, to: ModelState): string {
  switch (action) {
    case 'AdmitPlan':
      return to.journal.phase === 'prepared' ? '取得写互斥，核对依赖并写 journal' : '依赖已变，返回 SourceChanged';
    case 'BeginRecovery':
      return from.server === 'needs-recovery' ? '请求恢复' : '取得服务锁后开始恢复';
    case 'CrashPublication':
      return from.journal.nextTarget === 3 ? '发布进程退出 [提交阶段尚未落盘]' : '发布进程退出';
    case 'FinishRecovery':
      switch (to.recovery.status) {
        case 'completed': return '目标均匹配计划，完成发布';
        case 'rolledBack': return '确认所有目标均为前像';
        case 'discarded': return '发现外部编辑，保留当前文件';
        case 'none': return '恢复结束';
      }
    default: return actionLabels[action] ?? action;
  }
}

export const colors = {
  发布: 'blue',
  中断: 'orange',
  恢复: 'purple',
  完成: 'teal',
};

export function group(value: ModelState): keyof typeof colors {
  switch (value.server) {
    case 'needs-recovery':
    case 'down': return '中断';
    case 'recovering': return '恢复';
    case 'ready': return '完成';
    case 'running':
    case 'replied': {
      const settled = value.journal.phase === 'absent' && Object.values(value.replies).some(reply => reply !== 'queued');
      return settled ? '完成' : '发布';
    }
  }
}
