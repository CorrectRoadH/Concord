import { canonicalPath } from "../model/index.js";
import { ConcordError, ProjectSchema, decode, type Change, type MutationReceipt, type shared_ProjectConfig as ProjectConfig, type Repository } from "../model/index.js";
import { renderTypeScriptConfig } from "../base/workspace/index.js";
import { initialConstitution } from "../domain/constitution/index.js";
import { onboardingGuide } from "../domain/onboarding/index.js";
import { projectTemplateFiles, templateBody } from "../domain/documents/index.js";
import { defaultWritingSource } from "../model/index.js";
import { EMPTY_CONCEPT_CATALOG } from "../model/index.js";
import { forbiddenSourcePart } from "../base/workspace/index.js";
import { AGENT_RULE_BEGIN } from "../base/workspace/index.js";
import { AGENT_RULE_END } from "../base/workspace/index.js";
import { AGENT_RULE_CONTENT } from "../base/workspace/index.js";


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
export interface InitializeOptions { readonly testRoots?: readonly string[]; readonly sourceRoots?: readonly string[]; readonly runner?: ProjectConfig['runner']; readonly constitutionBody?: string; readonly adoptConstitution?: boolean; readonly constitutionReason?: string; readonly constitutionImpact?: string; readonly constitutionSources?: readonly string[] }
export interface InitializationReceipt extends MutationReceipt { readonly config: ProjectConfig; readonly createdPaths: readonly string[]; readonly preservedPaths: readonly string[] }

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
export function initialize(repo: Repository, dryRun = false, options: InitializeOptions = {}): InitializationReceipt {
  const config = decode(ProjectSchema, { ...(options.testRoots === undefined ? {} : { testRoots: options.testRoots }), ...(options.sourceRoots === undefined ? {} : { sourceRoots: options.sourceRoots }), ...(options.runner === undefined ? {} : { runner: options.runner }) }, 'init configuration');
  for (const root of [...(config.testRoots ?? []), ...(config.sourceRoots ?? [])]) {
    canonicalPath(root);
    if (forbiddenSourcePart(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot or testRoot: ${root}`);
    repo.absolute(root);
  }
  for (const path of config.runner?.sourceFiles ?? []) repo.absolute(path);
  const active = options.adoptConstitution === true;
  const constitution = initialConstitution({ body: options.constitutionBody ?? templateBody('constitution', 'Project'), active, reason: options.constitutionReason, impact: options.constitutionImpact, sources: options.constitutionSources, exists: path => repo.read(path) !== undefined });
  const paths: Record<string, string> = { ...(Object.keys(config).length === 0 ? {} : { 'concord.config.ts': renderTypeScriptConfig(config) }), 'docs/constitution.md': constitution.source, ...(constitution.decision === undefined ? {} : { [constitution.decision.path]: constitution.decision.after! }), 'docs/concord.md': onboardingGuide, ...projectTemplateFiles() };
  const preservedPaths: string[] = [];
  for (const [path, name] of [['docs/README.md', 'project-index'], ['docs/concepts.md', 'concepts'], ['docs/architecture.md', 'project-architecture']] as const) {
    if (repo.read(path) === undefined) paths[path] = name === 'concepts' ? EMPTY_CONCEPT_CATALOG : templateBody(name, 'Project');
    else preservedPaths.push(path);
  }
  if (repo.read('docs/concord-writing.json') === undefined) paths['docs/concord-writing.json'] = defaultWritingSource;
  else preservedPaths.push('docs/concord-writing.json');
  const sections: Record<string, [string, string, string]> = {
    'docs/feature/README.md': ['Features', 'Adopted product contracts. Write the target behavior and link complete user paths.', 'new feature'],
    'docs/roadmap/README.md': ['Roadmap', 'Settled directions awaiting adoption as current Feature contracts.', 'new roadmap'],
    'docs/design/README.md': ['Design decisions', 'Compare self-contained candidates against shared goals and constraints. Record selection with design decide.', 'new design'],
    'docs/engineering/README.md': ['Engineering', 'Repository testing and maintenance mechanisms, their usage and acceptance requirements.', 'new engineering'],
    'docs/research/README.md': ['Research', 'Dated external facts and primary sources informing decisions.', 'new research'],
    'docs/issues/README.md': ['Local feedback and observations', 'Editable local feedback, imported source snapshots, and investigation links. Concord reads configured providers only during explicit sync/import and never mutates remote issues.', 'new issue'],
  };
  sections['memory/README.md'] = ['Engineering memory', 'Decisions, insights and notes. Edit files directly and validate with concord check.', 'new memory'];
  for (const [path, [title, description, command]] of Object.entries(sections)) paths[path] = `# ${title}\n\n${description}\n\nStart with \`concord ${command} --help\`.\nUse \`concord list\` to discover documents.\n`;
  for (const path of Object.keys(paths)) if (repo.read(path) !== undefined) throw new ConcordError('InitializationConflict', `${path} already exists; no existing file will be overwritten`);
  const agentBefore = repo.read('AGENTS.md') ?? null;
  const agentAfter = withAgentInstructions(agentBefore ?? '');
  const changes: Change[] = Object.entries(paths).map(([path, after]) => ({ path, before: null, after }));
  if (agentBefore !== agentAfter) changes.push({ path: 'AGENTS.md', before: agentBefore, after: agentAfter });
  const receipt = repo.publish('init', changes, dryRun);
  return { ...receipt, config, createdPaths: receipt.changedPaths, preservedPaths };
}
