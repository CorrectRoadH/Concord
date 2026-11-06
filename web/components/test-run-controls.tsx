// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/inspect-implementation-and-tests.md#run
import { Play, Square } from 'lucide-react';
import type { AnnotatedCase, ViewJobState } from '../../src/model/index.ts';
import { useWorkspace } from '../workspace.tsx';
import { Button } from './ui/button.tsx';

const stateLabels: Readonly<Record<ViewJobState, string>> = {
  queued: '排队', running: '运行中', cancelling: '取消中', cancelled: '已取消',
  completed: '已完成', failed: '失败', 'cleanup-failed': '清理失败',
};
const outcomeLabels = { pass: '通过', green: '通过', fail: '失败', red: '失败', invalid: '无效' } as const;

export function TestRunControls({ testCase }: { testCase: Pick<AnnotatedCase, 'id' | 'status' | 'skipped'> }) {
  const { snapshot, jobs, busy, runCase, cancelJob } = useWorkspace();
  const job = jobs.find(item => item.caseId === testCase.id);
  const canCancel = job?.state === 'queued' || job?.state === 'running';
  const slotOccupied = jobs.some(item => ['queued', 'running', 'cancelling', 'cleanup-failed'].includes(item.state));
  const unavailable = !snapshot.project?.runner ? '先配置 runner' : testCase.status !== 'active' || testCase.skipped ? '仅运行 active 且未跳过的测试声明' : undefined;
  return <div className="flex flex-col gap-2">
    <div className="button-row">
      <Button size="sm" variant="outline" aria-label="运行测试" title={unavailable} disabled={busy || slotOccupied || unavailable !== undefined} onClick={() => { void runCase(testCase.id); }}><Play data-icon="inline-start" />运行</Button>
      {canCancel && <Button size="sm" variant="outline" aria-label="取消运行" onClick={() => { void cancelJob(job.id); }}><Square data-icon="inline-start" />取消运行</Button>}
      {job && <span role="status">{stateLabels[job.state]}{job.evidence && ` · ${outcomeLabels[job.evidence.commandOutcome]}`}</span>}
    </div>
    {job?.error && <p role="alert">{job.error.code}：{job.error.message}</p>}
    {job?.evidence && <div className="muted">
      <p>退出码：{job.evidence.exitCode ?? '无'}{job.evidence.signal && ` · 信号：${job.evidence.signal}`}{job.evidence.timedOut && ' · 已超时'}{!job.evidence.cleanupOk && ' · 进程组清理未确认'}</p>
      {job.evidence.scope === 'native' && job.evidence.gaps.length > 0 && <p>{job.evidence.gaps.join('、')}</p>}
    </div>}
  </div>;
}
