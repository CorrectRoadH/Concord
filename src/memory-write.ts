import { renderOwnerFrontmatter } from './owner-frontmatter.js';
import { ConcordError, DocumentSchema, decode, type Change, type MemoryMeta, type ProjectConfig } from './shared.js';

type MemorySources = NonNullable<ProjectConfig['memorySources']>;
export const DEFAULT_MEMORY_SOURCES: MemorySources = [{ name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true }];

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
/** The directory a new Memory is written to: the selected source, or the single defaultWrite source. */
export function memoryWriteDirectory(sources: MemorySources | undefined, selector?: string): string {
  const all = sources ?? DEFAULT_MEMORY_SOURCES;
  const chosen = selector === undefined ? all.filter(source => source.defaultWrite === true) : all.filter(source => source.name === selector || source.path === selector);
  if (chosen.length !== 1) throw new ConcordError(selector === undefined ? 'DefaultMemorySourceInvalid' : 'MemorySourceNotFound', `Expected one Memory write source, found ${chosen.length}`);
  if (chosen[0]!.access !== 'read-write') throw new ConcordError('ReadOnlyMemorySource', `Memory source ${chosen[0]!.name} is read-only`);
  return chosen[0]!.path;
}

export function renderMemorySource(metadata: MemoryMeta, body: string): string {
  const valid = decode(DocumentSchema, metadata, `memory:${metadata.id}`);
  const content = /^# /mu.test(body) ? body : `# ${valid.title}\n\n${body}`;
  return `${renderOwnerFrontmatter(valid)}${content.endsWith('\n') ? content : `${content}\n`}`;
}
// @concord-end

export interface ConstitutionDecisionInput {
  readonly adoption: boolean;
  readonly reason: string;
  readonly impact: string;
  readonly sources: readonly string[];
  readonly promotions: readonly string[];
  readonly at: string;
}

// @concord-begin
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md#amend
/** One current Decision per adoption or amendment, created in the same publication as the constitution. */
export function constitutionDecisionChange(memorySources: MemorySources | undefined, exists: (path: string) => boolean, input: ConstitutionDecisionInput): Change {
  const directory = memoryWriteDirectory(memorySources);
  const date = input.at.slice(0, 10);
  let sequence = 1;
  while (exists(`${directory}/constitution-${date}-${sequence}.md`)) sequence += 1;
  const id = `constitution-${date}-${sequence}`;
  const summary = input.reason.split(/[\r\n\u2028\u2029]/u)[0]!;
  const title = summary.length > 60 ? `${summary.slice(0, 58)}…` : summary;
  const sources = input.sources.length === 0 ? '- 无' : input.sources.map(source => `- \`${source}\``).join('\n');
  const body = `宪法${input.adoption ? '采用' : '修订'}，日期 ${date}。\n\n## 理由\n\n${input.reason}\n\n## 影响\n\n${input.impact}\n\n## 来源\n\n${sources}\n`;
  const metadata: MemoryMeta = { format: 'concord.document/v1', id, title, createdAt: input.at, kind: 'memory', memoryKind: 'decision', state: 'current', epoch: 0, promotions: [...input.promotions], history: [] };
  return { path: `${directory}/${id}.md`, before: null, after: renderMemorySource(metadata, body) };
}
// @concord-end
