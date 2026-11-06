import { RuntimeEnvironment } from '../base/environment/index.ts';
import { Effect } from 'effect';
import { canonicalPath } from "../model/index.ts";
import { ConcordError, failure, inRepositorySnapshot, ProjectSchema, InitializationReceiptSchema, decode, type Change, type WritingGuide, type shared_ProjectConfig as ProjectConfig, type Repository } from "../model/index.ts";
import { renderTypeScriptConfig } from "../base/workspace/index.ts";
import { onboardingGuide } from "../domain/onboarding/index.ts";
import { projectTemplateFiles, templateCatalog } from "../domain/documents/index.ts";
import { defaultWritingSource } from "../model/index.ts";
import { EMPTY_CONCEPT_CATALOG } from "../model/index.ts";
import { forbiddenSourcePart } from "../base/workspace/index.ts";
import { AGENT_RULE_BEGIN } from "../base/workspace/index.ts";
import { AGENT_RULE_END } from "../base/workspace/index.ts";
import { AGENT_RULE_CONTENT } from "../base/workspace/index.ts";
import { selectWritingGuide } from './project-onboarding.ts';
import { planWorkflowSkills } from './workflow-skills.ts';


export function withAgentInstructions(source: string): string {
  const begin = source.indexOf(AGENT_RULE_BEGIN);
  const end = source.indexOf(AGENT_RULE_END);
  if ((begin === -1) !== (end === -1) || (begin !== -1 && end < begin)) {
    throw new ConcordError('InitializationConflict', 'AGENTS.md contains an incomplete Concord-managed instruction block');
  }
  const block = `${AGENT_RULE_BEGIN}\n${AGENT_RULE_CONTENT}\n${AGENT_RULE_END}`;
  if (begin !== -1) return `${source.slice(0, begin)}${block}${source.slice(end + AGENT_RULE_END.length)}`;
  if (source.trim() === '') return `${block}\n`;
  return `${source.replace(/\n*$/u, '')}\n\n${block}\n`;
}
export interface InitializeOptions { readonly testRoots?: readonly string[]; readonly sourceRoots?: readonly string[]; readonly runner?: ProjectConfig['runner'] }
export type InitializationReceipt = typeof InitializationReceiptSchema.Type;

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#init
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#install
export const initialize = Effect.fn('initialize')(function*(repo: Repository, dryRun = false, options: InitializeOptions = {}, initialGuide?: WritingGuide) {
  const catalog = yield* templateCatalog();
  const runtime = yield* RuntimeEnvironment;
  return yield* Effect.try({ try: (): InitializationReceipt => inRepositorySnapshot(repo, () => {
  const guide = initialGuide ?? selectWritingGuide(repo.root, runtime.env);
  const config = decode(ProjectSchema, { ...(options.testRoots === undefined ? {} : { testRoots: options.testRoots }), ...(options.sourceRoots === undefined ? {} : { sourceRoots: options.sourceRoots }), ...(options.runner === undefined ? {} : { runner: options.runner }) }, 'init configuration');
  for (const root of [...(config.testRoots ?? []), ...(config.sourceRoots ?? [])]) {
    canonicalPath(root);
    if (forbiddenSourcePart(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot or testRoot: ${root}`);
    repo.absolute(root);
  }
  for (const path of config.runner?.sourceFiles ?? []) repo.absolute(path);
  const paths: Record<string, string> = { ...(Object.keys(config).length === 0 ? {} : { 'concord.config.ts': renderTypeScriptConfig(config) }), 'docs/taste.md': catalog.render('taste', 'Project'), 'docs/concord.md': onboardingGuide, ...projectTemplateFiles(catalog) };
  const preservedPaths: string[] = [];
  for (const [path, name] of [['docs/README.md', 'project-index'], ['docs/concepts.md', 'concepts'], ['docs/architecture.md', 'project-architecture']] as const) {
    if (repo.read(path) === undefined) paths[path] = name === 'concepts' ? EMPTY_CONCEPT_CATALOG : catalog.render(name, 'Project');
    else preservedPaths.push(path);
  }
  if (repo.read('docs/writing.md') === undefined) paths['docs/writing.md'] = defaultWritingSource;
  else preservedPaths.push('docs/writing.md');
  const sections: Record<string, [string, string, string]> = {
    'docs/feature/README.md': ['Features', 'Adopted product contracts. Write the target behavior and link complete user paths.', 'new feature'],
    'docs/roadmap/README.md': ['Roadmap', 'Settled directions awaiting adoption as current Feature contracts.', 'new roadmap'],
    'docs/design/README.md': ['Design decisions', 'Write one open tradeoff in one file; adopt its rule in Spec and delete the Design once decided.', 'new design'],
    'docs/engineering/README.md': ['Engineering', 'Repository testing and maintenance mechanisms, their usage and acceptance requirements.', 'new engineering'],
    'docs/issues/README.md': ['Local feedback and observations', 'Editable local feedback, imported source snapshots, and investigation links. Concord reads configured providers only during explicit sync/import and never mutates remote issues.', 'new issue'],
  };
  sections['memory/README.md'] = ['Engineering memory', 'Reusable lessons from developing this project: measurements, root causes, pitfalls and tradeoffs. Edit files directly and validate with concord check.', 'new memory'];
  for (const [path, [title, description, command]] of Object.entries(sections)) paths[path] = `# ${title}\n\n${description}\n\nStart with \`concord ${command} --help\`.\nUse \`concord list\` to discover documents.\n`;
  for (const path of Object.keys(paths)) if (repo.read(path) !== undefined) throw new ConcordError('InitializationConflict', `${path} already exists; no existing file will be overwritten`);
  const agentBefore = repo.read('AGENTS.md') ?? null;
  const agentAfter = withAgentInstructions(agentBefore ?? '');
  const skills = planWorkflowSkills(repo);
  preservedPaths.push(...skills.unchangedPaths);
  const changes: Change[] = Object.entries(paths).map(([path, after]) => ({ path, before: null, after }));
  if (agentBefore !== agentAfter) changes.push({ path: 'AGENTS.md', before: agentBefore, after: agentAfter });
  changes.push(...skills.changes);
  const receipt = repo.publish('init', changes, dryRun);
  return decode(InitializationReceiptSchema, { ...receipt, config, createdPaths: receipt.changedPaths, preservedPaths, guide }, 'init result');
  }), catch: failure });
});
// @concord-end
