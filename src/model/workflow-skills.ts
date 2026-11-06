// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#update
import { Schema } from 'effect';

export const WORKFLOW_SKILL_TOPICS = ['spec', 'implement', 'review', 'fix'] as const;
export type WorkflowSkillTopic = typeof WORKFLOW_SKILL_TOPICS[number];
export const workflowSkillPaths: readonly string[] = ['.agents', '.claude'].flatMap(directory =>
  WORKFLOW_SKILL_TOPICS.map(topic => `${directory}/skills/concord-${topic}/SKILL.md`));
export const isWorkflowSkillPath = (path: string): boolean => workflowSkillPaths.includes(path);
export const isManagedWorkflowSkill = (source: string): boolean => /^<!-- concord-managed(?: version=[^\s<>]+)? -->\r?$/mu.test(source);
export const isObsoleteWorkflowSkillRemoval = (operation: string, change: { readonly path: string; readonly before: string | null; readonly after: string | null }): boolean =>
  operation === 'skills-install' && /^\.(?:agents|claude)\/skills\/concord-[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(change.path)
  && !isWorkflowSkillPath(change.path) && change.after === null && change.before !== null && isManagedWorkflowSkill(change.before);
export const SkillsInstallReceiptSchema = Schema.Struct({
  operation: Schema.Literal('skills-install'),
  dryRun: Schema.Boolean,
  createdPaths: Schema.Array(Schema.String),
  updatedPaths: Schema.Array(Schema.String),
  removedPaths: Schema.Array(Schema.String),
  unchangedPaths: Schema.Array(Schema.String),
  recoveryRequired: Schema.optional(Schema.Boolean),
});
