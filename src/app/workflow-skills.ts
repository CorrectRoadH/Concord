// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
import { Effect } from 'effect';
import { installedConcordVersion } from '../base/installation/index.ts';
import { ConcordError, failure, inRepositorySnapshot, isManagedWorkflowSkill, isObsoleteWorkflowSkillRemoval, workflowSkillPaths, WORKFLOW_SKILL_TOPICS, type Change, type Repository, type WorkflowSkillTopic } from '../model/index.ts';

const descriptions: Record<WorkflowSkillTopic, string> = {
  spec: '把需求写成 Concord Spec，明确行为、边界和验收方式。',
  implement: '依据已有 Concord Spec 实现功能并验证代码、测试与契约一致。',
  review: '只读验收一组改动，按 Concord Spec 检查 diff、关系与实际行为。',
  fix: '修复违反 Concord Spec 的缺陷，用回归测试与修复核验确认结果。',
};
const render = (topic: WorkflowSkillTopic, version: string): string => `---\nname: concord-${topic}\ndescription: ${descriptions[topic]}\n---\n\n<!-- concord-managed version=${version} -->\n\n运行 \`concord --skill ${topic}\`，读取并执行其中的说明。项目的 \`AGENTS.md\` 指定了其它运行方式（例如 \`bun run concord\`）时按它运行。命令后的文字是本次任务。\n`;
const occupied = (path: string): never => { throw new ConcordError('SkillPathOccupied', `Workflow skill path is occupied: ${path}`, { path }); };
const comparableSource = (source: string): string => source.replace(/^<!-- concord-managed version=[^\s<>]+ -->\r?$/mu, '<!-- concord-managed -->');

function skillSources(repo: Repository): Map<string, string> {
  const sources = new Map<string, string>();
  for (const directory of ['.agents', '.claude']) {
    for (const path of repo.files(`${directory}/skills`).filter(path => /^\.(?:agents|claude)\/skills\/concord-[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(path))) {
      const source = repo.read(path);
      if (source !== undefined) sources.set(path, source);
    }
  }
  return sources;
}

/** Unversioned markers predate every version; unrelated or newer versions never prompt. */
function isOlderVersion(generated: string | undefined, current: string): boolean {
  if (generated === undefined) return true;
  const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value);
  const left = parse(generated), right = parse(current);
  if (left === null || right === null) return false;
  for (let part = 1; part <= 3; part++) {
    const difference = Number(left[part]) - Number(right[part]);
    if (difference !== 0) return difference < 0;
  }
  if (left[4] === right[4] || left[4] === undefined) return false;
  if (right[4] === undefined) return true;
  const a = left[4].split('.'), b = right[4].split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const x = a[index], y = b[index];
    if (x === y) continue;
    if (x === undefined) return true;
    if (y === undefined) return false;
    const numericX = /^\d+$/u.test(x), numericY = /^\d+$/u.test(y);
    return numericX && numericY ? Number(x) < Number(y) : numericX !== numericY ? numericX : x < y;
  }
  return false;
}

export function inspectWorkflowSkills(repo: Repository, version = installedConcordVersion()) {
  const sources = skillSources(repo), paths = new Set<string>();
  for (const [path, source] of sources) {
    if (!isManagedWorkflowSkill(source)) continue;
    if (!workflowSkillPaths.includes(path)) { paths.add(path); continue; }
    const topic = WORKFLOW_SKILL_TOPICS.find(name => path.endsWith(`/concord-${name}/SKILL.md`))!;
    const generated = /^<!-- concord-managed(?: version=([^\s<>]+))? -->\r?$/mu.exec(source)?.[1];
    if (isOlderVersion(generated, version) && comparableSource(source) !== comparableSource(render(topic, version))) paths.add(path);
  }
  for (const topic of WORKFLOW_SKILL_TOPICS) {
    const pair = ['.agents', '.claude'].map(directory => `${directory}/skills/concord-${topic}/SKILL.md`);
    const [left, right] = pair.map(path => sources.get(path));
    if (left !== undefined && right !== undefined && comparableSource(left) !== comparableSource(right)) for (const path of pair) paths.add(path);
  }
  const outdated = [...paths].sort();
  return { installed: [...sources.values()].some(isManagedWorkflowSkill), advisories: outdated.length === 0 ? [] : [{
    code: 'WorkflowSkillsOutdated', path: outdated[0]!, message: `Run concord skills install: ${outdated.join(', ')}`, details: { paths: outdated },
  }] };
}

/** Inspect every component before a read can follow or reject an occupied path. */
export function planWorkflowSkills(repo: Repository, version = installedConcordVersion()): {
  readonly changes: readonly Change[];
  readonly createdPaths: readonly string[];
  readonly updatedPaths: readonly string[];
  readonly removedPaths: readonly string[];
  readonly unchangedPaths: readonly string[];
} {
  const changes: Change[] = [], createdPaths: string[] = [], updatedPaths: string[] = [], removedPaths: string[] = [], unchangedPaths: string[] = [];
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
    if (before !== null && !isManagedWorkflowSkill(before)) occupied(path);
    const topic = WORKFLOW_SKILL_TOPICS.find(name => path.endsWith(`/concord-${name}/SKILL.md`))!;
    const after = render(topic, version);
    if (before === after) unchangedPaths.push(path);
    else {
      changes.push({ path, before, after });
      (before === null ? createdPaths : updatedPaths).push(path);
    }
  }
  for (const [path, before] of skillSources(repo)) {
    const change = { path, before, after: null };
    if (isObsoleteWorkflowSkillRemoval('skills-install', change)) { changes.push(change); removedPaths.push(path); }
  }
  return { changes, createdPaths, updatedPaths, removedPaths: removedPaths.sort(), unchangedPaths };
}

export const installWorkflowSkills = Effect.fn('skills.install')(function*(repo: Repository, dryRun = false) {
  return yield* Effect.tryPromise({ try: async () => (await inRepositorySnapshot(repo, async () => {
    const { changes, createdPaths, updatedPaths, removedPaths, unchangedPaths } = planWorkflowSkills(repo);
    const receipt = (await repo.publish('skills-install', changes, dryRun));
    return { operation: 'skills-install' as const, dryRun: receipt.dryRun, createdPaths, updatedPaths, removedPaths, unchangedPaths,
      ...(receipt.recoveryRequired === undefined ? {} : { recoveryRequired: receipt.recoveryRequired }) };
  })), catch: failure }).pipe(Effect.uninterruptible);
});
