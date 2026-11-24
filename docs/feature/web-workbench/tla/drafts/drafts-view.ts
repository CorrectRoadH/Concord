interface ModelState {
  readonly draft: {
    readonly generation: number;
    readonly text: number;
    readonly baseline: number;
  };
  readonly save: {
    readonly phase: 'idle' | 'sending' | 'readback' | 'failed' | 'conflict';
  };
  readonly route: {
    readonly waiting: boolean;
    readonly discarding: number;
    readonly discarded: boolean;
    readonly latest: number;
    readonly url: number;
  };
  readonly owner: number;
  readonly oldCleanup: boolean;
}

export const title = 'Web 草稿与导航';

export function state({ draft, save, route, owner, oldCleanup }: ModelState): string {
  if (route.url !== 0) {
    if (route.url !== route.latest) return '已打开过期目标';
    if (!route.discarded && (draft.text !== draft.baseline || save.phase === 'sending' || save.phase === 'readback')) {
      return '草稿尚未保存就离开了';
    }
    return '已打开目标页';
  }
  if (route.discarding !== 0) return '正在丢弃草稿';
  if (save.phase === 'conflict') return '磁盘已变化，保留两份内容';
  if (save.phase === 'failed') return '保存失败，留在原页';
  if (save.phase === 'sending' || save.phase === 'readback') return '正在保存草稿';
  if (draft.text !== draft.baseline) return route.waiting ? '离开前等待保存' : '有待保存的草稿';
  if (owner === 2 && draft.generation === 0) {
    return oldCleanup ? '新编辑器已接管' : '旧编辑器已清理';
  }
  return '没有待保存更改';
}

const steps = {
  EditDraft: '编辑草稿',
  SaveAfterPause: '开始保存',
  SaveBeforeLeaving: '开始保存',
  AcceptWrite: '服务写入完成，等待读回',
  ConfirmReadback: '确认本次保存',
  RejectSave: '保存失败',
  RejectConflictingWrite: '发现外部编辑',
  ReadbackFindsExternalEdit: '发现外部编辑',
  MakeExternalEdit: '外部编辑文件',
  ReadExternalVersion: '重新读取磁盘版本',
  RequestNavigation: '请求离开',
  OpenCleanTarget: '打开目标页',
  CurrentNavigationMayProceed: '打开目标页',
  FinishStaleSaveCallback: '旧保存回调尝试跳转',
  BeginDiscard: '选择丢弃草稿',
  FinishDiscard: '恢复已保存版本',
  CancelNavigation: '选择留在此页',
  ActivateNewOwner: '切换编辑器',
  CleanupOldOwner: '清理旧编辑器',
};

export function step(action: string, from: ModelState, to: ModelState): string | null {
  if (action === 'EditDraft' && to.draft.text === to.draft.baseline) return '撤销至已保存版本';
  if (action === 'RequestNavigation' && to.route.latest === 2) return '更换离开目标';
  if (action === 'FinishDiscard' && to.route.url !== 0) return '丢弃草稿并离开';
  if (action === 'ConfirmReadback' && from.draft.text !== to.draft.baseline) return '已保存先前版本，保留继续编辑的草稿';
  return Object.entries(steps).find(([name]) => name === action)?.[1] ?? null;
}

export const colors = {
  草稿: 'orange',
  保存: 'blue',
  阻挡: 'pink',
  完成: 'teal',
};

export function group(value: ModelState): keyof typeof colors | undefined {
  if (value.route.url !== 0) return '完成';
  if (value.route.discarding !== 0 || value.save.phase === 'sending' || value.save.phase === 'readback') return '保存';
  if (value.save.phase === 'conflict' || value.save.phase === 'failed') return '阻挡';
  if (value.draft.text !== value.draft.baseline) return '草稿';
  return undefined;
}
