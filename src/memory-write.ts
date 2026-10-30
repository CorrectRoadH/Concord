import { renderDocument } from './document-codec.js';
import { ConcordError, type Change, type MemoryMeta } from './shared.js';

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
export function renderMemorySource(metadata: MemoryMeta, body: string): string {
  return renderDocument(metadata, body);
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
export function constitutionDecisionChange(exists: (path: string) => boolean, input: ConstitutionDecisionInput): Change {
  const directory = 'memory';
  const date = input.at.slice(0, 10);
  let sequence = 1;
  while (exists(`${directory}/constitution-${date}-${sequence}.md`)) sequence += 1;
  const id = `constitution-${date}-${sequence}`;
  const summary = input.reason.split(/[\r\n\u2028\u2029]/u)[0]!;
  const title = summary.length > 60 ? `${summary.slice(0, 58)}…` : summary;
  const sources = input.sources.length === 0 ? '- 无' : input.sources.map(source => `- \`${source}\``).join('\n');
  const body = `## 适用范围\n\n项目宪法及依赖其条款的工作。\n\n宪法${input.adoption ? '采用' : '修订'}，日期 ${date}。\n\n## 理由\n\n${input.reason}\n\n## 影响\n\n${input.impact}\n\n## 来源\n\n${sources}\n`;
  const metadata: MemoryMeta = { format: 'concord.document/v1', id, title, createdAt: input.at, kind: 'memory', type: 'decision', status: 'current', relations: input.promotions.map(target => ({ role: 'amends', target })) };
  return { path: `${directory}/${id}.md`, before: null, after: renderMemorySource(metadata, body) };
}
// @concord-end
