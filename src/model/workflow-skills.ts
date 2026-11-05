// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
import { Schema } from 'effect';

export const WORKFLOW_SKILL_TOPICS = ['spec', 'implement', 'review', 'fix'] as const;
export type WorkflowSkillTopic = typeof WORKFLOW_SKILL_TOPICS[number];
export const workflowSkillPaths: readonly string[] = ['.agents', '.claude'].flatMap(directory =>
  WORKFLOW_SKILL_TOPICS.map(topic => `${directory}/skills/concord-${topic}/SKILL.md`));
export const isWorkflowSkillPath = (path: string): boolean => workflowSkillPaths.includes(path);
export const SkillsInstallReceiptSchema = Schema.Struct({
  operation: Schema.Literal('skills-install'),
  dryRun: Schema.Boolean,
  createdPaths: Schema.Array(Schema.String),
  updatedPaths: Schema.Array(Schema.String),
  unchangedPaths: Schema.Array(Schema.String),
  recoveryRequired: Schema.optional(Schema.Boolean),
});
