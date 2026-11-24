const phases = {
  downloading: '等待校验归档',
  verified: '归档校验通过',
  inspecting: '开始检查安装目录',
  staged: '新版本已在临时目录备妥',
  ready: '版本目录可用',
  linked: '入口已指向目标版本',
  activated: '已记录本次激活',
  scanned: '正在核对旧版本',
  reclaiming: '旧版本通过回收检查',
  quarantined: '旧版本已移到隐藏目录',
  done: '安装结束',
  rejected: '安装已拒绝',
  interrupted: '安装已中断',
};

type Attempt = {
  readonly phase: keyof typeof phases;
  readonly target: 'candidate' | 'victim';
  readonly reclaim: string;
};

type InstallationState = {
  readonly attempts: { readonly A: Attempt; readonly B?: Attempt };
  readonly receipts: Readonly<Record<string, string>>;
  readonly link: string;
  readonly service: 'using-old' | 'between-services' | 'using-victim' | 'stopped' | 'refused';
  readonly nestedArchives: readonly string[];
  readonly unsafeRemovals: readonly string[];
};

export const title = '安装目录发布与旧版本回收';

export const state = (model: InstallationState): string => {
  const primary = model.attempts.A;
  const concurrent = model.attempts.B;
  const labels = [phases[primary.phase]];
  if (concurrent) {
    const target = concurrent.target === 'candidate' ? '安装同版本' : '回退到旧版本';
    labels.push(`并行${target}：${phases[concurrent.phase]}`);
  }
  if ([primary, concurrent].some(attempt => attempt?.reclaim === 'victim')) {
    if (model.service === 'between-services') labels.push('服务准备登记旧版本');
    if (model.service === 'using-victim') labels.push('待回收版本已被服务使用');
  }
  if (model.receipts[model.link] === 'absent') labels.push('当前入口失效');
  if (model.nestedArchives.length > 0) labels.push('已有版本多出一份解压目录');
  if (model.unsafeRemovals.length > 0) labels.push('应保留的版本已被删除');
  return labels.join('，');
};

const steps: Readonly<Record<string, string>> = {
  VerifyArchive: '校验下载的归档',
  AcquireInstallLock: '开始处理版本目录',
  RejectBusyInstall: '另一安装正在进行，结束本次安装',
  StageNewVersion: '解压并写入校验收据',
  ReuseVersion: '收据相同，复用版本目录',
  RejectVersion: '收据缺失或不同，结束安装',
  PublishDirectory: '发布完整的版本目录',
  NestStagingDirectory: '把解压目录移入已有版本',
  SwitchLink: '原子替换 Concord 入口',
  RecordActivation: '写入激活时间',
  InterruptInstall: '收到中断并执行清理',
  ScanRetention: '按激活时间检查旧版本',
  CheckReclaim: '核对旧版本的使用标记',
  QuarantineVersion: '将旧版本移到隐藏目录',
  RestoreLiveVersion: '确认版本仍在使用，移回原位',
  ReclaimVersion: '删除选中的旧版本',
  FinishRetention: '结束旧版本清理',
  ReleaseMarker: '服务退出，移除在用标记',
  RegisterMarker: '服务登记正在使用的旧版本',
  RefuseMarker: '安装路径不可用，服务拒绝启动',
  Done: '结束',
};

export const step = (action: string, from: InstallationState, to: InstallationState): string | null => {
  const phase = from.attempts.A.phase;
  if (!from.attempts.B) {
    if (action === 'InterruptInstall' && (phase === 'staged' || phase === 'quarantined')) return null;
    if (action === 'ReleaseMarker' && (phase === 'quarantined' || from.service === 'using-victim')) return null;
  }
  const label = steps[action];
  if (!label) return null;
  const before = from.attempts.B;
  const after = to.attempts.B;
  if (before && after && (before.phase !== after.phase || before.reclaim !== after.reclaim)) {
    return `并行安装：${label}`;
  }
  return label;
};

export const group = (model: InstallationState): string => {
  switch (model.attempts.A.phase) {
    case 'downloading':
    case 'verified':
    case 'inspecting':
    case 'staged':
    case 'ready': return '准备版本';
    case 'linked':
    case 'activated': return '激活版本';
    case 'scanned':
    case 'reclaiming':
    case 'quarantined':
    case 'done': return '回收版本';
    case 'interrupted':
    case 'rejected': return '提前结束';
  }
};

export const colors = {
  准备版本: 'blue',
  激活版本: 'teal',
  回收版本: 'purple',
  提前结束: 'orange',
};
