// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
import { Effect } from 'effect';
import { ConcordError, failure, inRepositorySnapshot, workflowSkillPaths, WORKFLOW_SKILL_TOPICS, type Change, type Repository, type WorkflowSkillTopic } from '../model/index.js';

const managedLine = '<!-- concord-managed -->';
const descriptions: Record<WorkflowSkillTopic, string> = {
  spec: '把需求写成 Concord Spec，明确行为、边界和验收方式。',
  implement: '依据已有 Concord Spec 实现功能并验证代码、测试与契约一致。',
  review: '只读验收一组改动，按 Concord Spec 检查 diff、关系与实际行为。',
  fix: '修复违反 Concord Spec 的缺陷，先提交失败回归，再修复并核验。',
};
const render = (topic: WorkflowSkillTopic): string => `---\nname: concord-${topic}\ndescription: ${descriptions[topic]}\n---\n\n${managedLine}\n\n运行 \`concord --skill ${topic}\`，读取并执行其中的说明。命令后的文字是本次任务。\n`;
const occupied = (path: string): never => { throw new ConcordError('SkillPathOccupied', `Workflow skill path is occupied: ${path}`, { path }); };

/** Inspect every component before a read can follow or reject an occupied path. */
export function planWorkflowSkills(repo: Repository): {
  readonly changes: readonly Change[];
  readonly createdPaths: readonly string[];
  readonly updatedPaths: readonly string[];
  readonly unchangedPaths: readonly string[];
} {
  const changes: Change[] = [], createdPaths: string[] = [], updatedPaths: string[] = [], unchangedPaths: string[] = [];
  for (const path of workflowSkillPaths) {
    const segments = path.split('/');
    for (let length = 1; length <= segments.length; length++) {
      const component = segments.slice(0, length).join('/');
      let status: ReturnType<NonNullable<Repository['inspect']>>;
      try { status = repo.inspect?.(component); }
      catch (cause) { if (cause instanceof ConcordError && cause.code === 'UnsafePath') occupied(component); throw cause; }
      if (status !== undefined && (status.symbolicLink || (length === segments.length ? !status.file : !status.directory))) occupied(component);
    }
    const before = repo.read(path) ?? null;
    if (before !== null && !before.split(/\r?\n/u).includes(managedLine)) occupied(path);
    const topic = WORKFLOW_SKILL_TOPICS.find(name => path.endsWith(`/concord-${name}/SKILL.md`))!;
    const after = render(topic);
    if (before === after) unchangedPaths.push(path);
    else {
      changes.push({ path, before, after });
      (before === null ? createdPaths : updatedPaths).push(path);
    }
  }
  return { changes, createdPaths, updatedPaths, unchangedPaths };
}

export const installWorkflowSkills = Effect.fn('skills.install')(function*(repo: Repository, dryRun = false) {
  return yield* Effect.try({ try: () => inRepositorySnapshot(repo, () => {
    const { changes, createdPaths, updatedPaths, unchangedPaths } = planWorkflowSkills(repo);
    const receipt = repo.publish('skills-install', changes, dryRun);
    return { operation: 'skills-install' as const, dryRun: receipt.dryRun, createdPaths, updatedPaths, unchangedPaths,
      ...(receipt.recoveryRequired === undefined ? {} : { recoveryRequired: receipt.recoveryRequired }) };
  }), catch: failure });
});
