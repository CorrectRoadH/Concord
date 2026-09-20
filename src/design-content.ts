// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/compare-design-plans.md
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent, Nodes } from 'mdast';
import { Schema } from 'effect';
import { markdownAnchor } from './refs.js';
import { type Finding } from './shared.js';

export type DesignSources = ReadonlyMap<string, string | undefined>;
type Status = 'satisfied' | 'partial' | 'not-satisfied' | 'pending';
interface Requirement { id: string; anchor: string }
export interface PlanAssessment { plan: string; eligible: boolean; limits: Record<string, Status>; goals: Record<string, Status> }
export interface DesignContentResult { findings: Finding[]; candidates: PlanAssessment[]; selected: string | undefined; rationale: string }
const StatusSchema = Schema.Literals(['satisfied', 'partial', 'not-satisfied', 'pending', '满足', '部分满足', '不满足', '待验证']);
const statusAliases = { 满足: 'satisfied', 部分满足: 'partial', 不满足: 'not-satisfied', 待验证: 'pending' } as const;

export function designContentPaths(base: string, alternatives: readonly string[]): string[] {
  return [`${base}/README.md`, `${base}/GOALS.md`, `${base}/LIMITS.md`, `${base}/DECISION.md`, ...alternatives.map(plan => `${base}/plans/${plan}/README.md`)];
}

function text(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if (['html', 'code', 'inlineCode', 'image', 'imageReference', 'linkReference'].includes(node.type)) return '';
  return 'children' in node ? node.children.map(child => text(child)).join('') : '';
}
const authored = (value: string): boolean => value.trim().length > 0 && !/\b(?:TODO|TBD)\b|待补充|待填写/iu.test(value);
const raw = (source: string, node: Nodes): string => source.slice(node.position?.start.offset, node.position?.end.offset);

/** The supported table dialect is four pipe-delimited cells, with escaped pipes. */
function cells(line: string): string[] | undefined {
  const value = line.trim();
  if (!value.startsWith('|') || !value.endsWith('|')) return undefined;
  const parts: string[] = []; let start = 1; let escapes = 0;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '|' && escapes % 2 === 0) { parts.push(value.slice(start, i).trim()); start = i + 1; }
    escapes = ch === '\\' ? escapes + 1 : 0;
  }
  return start === value.length && parts.length === 4 ? parts : undefined;
}

function table(source: string, node: RootContent): string[][] | undefined {
  if (node.type !== 'paragraph') return undefined;
  const rows = raw(source, node).split(/\r?\n/u).map(cells);
  if (rows.length < 3 || rows.some(row => row === undefined) || !rows[1]!.every(cell => /^:?-{3,}:?$/u.test(cell))) return undefined;
  return rows as string[][];
}

function inlineLink(value: string): { label: string; url: string } | undefined {
  const nodes = fromMarkdown(value).children;
  const paragraph = nodes[0];
  if (nodes.length !== 1 || paragraph?.type !== 'paragraph' || paragraph.children.length !== 1) return undefined;
  const node = paragraph.children[0];
  return node?.type === 'link' && node.children.every(child => child.type === 'text') ? { label: text(node), url: node.url } : undefined;
}

export function validateDesignContent(base: string, alternatives: readonly string[], sources: DesignSources, expectedSelection?: string): DesignContentResult {
  const findings: Finding[] = [];
  const report = (path: string, code: string, message: string) => findings.push({ path, code, message });
  const nodesFor = (path: string): RootContent[] => {
    const source = sources.get(path);
    if (source === undefined) { report(path, 'DesignPageMissing', 'Required Design page is missing'); return []; }
    const nodes = fromMarkdown(source).children;
    if (nodes.filter(node => node.type === 'heading' && node.depth === 1).length !== 1) report(path, 'DesignHeadingInvalid', 'Expected exactly one H1 document title');
    return nodes;
  };
  const section = (path: string, nodes: RootContent[], names: string[]): RootContent[] => {
    const indices = nodes.flatMap((node, i) => node.type === 'heading' && node.depth === 2 && names.includes(text(node)) ? [i] : []);
    if (indices.length !== 1) { report(path, 'DesignSectionInvalid', `Expected exactly one H2 ${names[0]} section`); return []; }
    const start = indices[0]! + 1;
    const next = nodes.findIndex((node, i) => i >= start && node.type === 'heading' && node.depth <= 2);
    return nodes.slice(start, next < 0 ? nodes.length : next);
  };
  const requirements = (file: 'GOALS' | 'LIMITS', prefix: 'G' | 'L'): Requirement[] => {
    const path = `${base}/${file}.md`; const nodes = nodesFor(path); const items: Requirement[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.type !== 'heading' || node.depth === 1) continue;
      const title = text(node); const match = new RegExp(`^(${prefix}[1-9][0-9]*)[:：]\\s*([^\\s].*)$`, 'u').exec(title);
      if (node.depth !== 2) {
        if (match) report(path, 'DesignHeadingInvalid', `${match[1]} must use H2`);
        continue;
      }
      if (!match || !node.children.every(child => child.type === 'text')) { report(path, 'DesignRequirementInvalid', `Each H2 must be ${prefix}<number>: <title> in plain text`); continue; }
      const id = match[1]!; const anchor = markdownAnchor(`## ${title}`)!;
      if (items.some(item => item.id === id || item.anchor === anchor)) report(path, 'DesignRequirementDuplicate', `${id} must be unique`);
      items.push({ id, anchor });
      const end = nodes.findIndex((next, index) => index > i && next.type === 'heading' && next.depth <= 2);
      const body = nodes.slice(i + 1, end < 0 ? nodes.length : end).filter(next => next.type === 'paragraph').map(text).join('\n');
      if (!authored(body)) report(path, 'DesignRequirementIncomplete', `${id} needs authored criteria and source`);
    }
    if (items.length === 0) report(path, 'DesignRequirementMissing', `At least one ${prefix} requirement is required`);
    return items;
  };
  const goals = requirements('GOALS', 'G'); const limits = requirements('LIMITS', 'L');
  const requirementsValid = findings.length === 0;
  const candidates = alternatives.map((plan): PlanAssessment => {
    const path = `${base}/plans/${plan}/README.md`; const source = sources.get(path) ?? ''; const startFindings = findings.length;
    const nodes = nodesFor(path);
    const responses = (items: Requirement[], file: 'GOALS' | 'LIMITS', names: string[]): Record<string, Status> => {
      const result: Record<string, Status> = {};
      const content = section(path, nodes, names);
      const tables = content.map(node => table(source, node)).filter(value => value !== undefined);
      if (tables.length !== 1) report(path, 'DesignTableInvalid', `${names[0]} requires exactly one four-column pipe table`);
      const seen = new Set<string>();
      for (const row of tables.flatMap(value => value.slice(2))) {
        const link = inlineLink(row[0]!); const item = items.find(item => item.id === link?.label);
        if (!item || link?.url !== `../../${file}.md#${item.anchor}`) { report(path, 'DesignRequirementReferenceInvalid', `${row[0]} must link its exact ${file} ID and heading`); continue; }
        if (seen.has(item.id)) report(path, 'DesignResponseDuplicate', `${item.id} must occur exactly once`);
        seen.add(item.id);
        try {
          const decoded = Schema.decodeUnknownSync(StatusSchema)(row[1]);
          const status: Status = decoded in statusAliases ? statusAliases[decoded as keyof typeof statusAliases] : decoded as Status;
          if (file === 'LIMITS' && status === 'partial') throw new Error('Limits cannot be partial');
          result[item.id] = status;
        } catch { report(path, 'DesignStatusInvalid', `${item.id}: invalid ${file} status ${row[1]}`); }
        for (const cell of row.slice(2)) {
          const paragraph = fromMarkdown(cell).children[0];
          if (paragraph?.type !== 'paragraph' || !authored(text(paragraph)) || paragraph.children.some(node => node.type === 'html' || node.type === 'linkReference')) report(path, 'DesignResponseIncomplete', `${item.id} requires authored mechanism/gap and evidence`);
        }
      }
      for (const item of items) if (!seen.has(item.id)) report(path, 'DesignResponseMissing', `${names[0]} must respond to ${item.id}`);
      return result;
    };
    const limitResponses = responses(limits, 'LIMITS', ['Limits', '约束', '限制']);
    const goalResponses = responses(goals, 'GOALS', ['Goals', '目标']);
    return { plan, eligible: requirementsValid && findings.length === startFindings && limits.length > 0 && limits.every(item => limitResponses[item.id] === 'satisfied'), limits: limitResponses, goals: goalResponses };
  });
  const decisionPath = `${base}/DECISION.md`; const decisionNodes = nodesFor(decisionPath);
  const decision = section(decisionPath, decisionNodes, ['Decision', '定案']);
  const declarations = decision.filter(node => node.type === 'paragraph').flatMap(node => {
    const children = node.children;
    if (children.length < 2 || children.length > 3 || children[0]?.type !== 'text' || !/^(?:Selected:\s*|选择\s*)$/u.test(children[0].value)) return [];
    const link = children[1]; const suffix = children[2];
    if (link?.type !== 'link' || (suffix !== undefined && (suffix.type !== 'text' || !/^[。.]?$/u.test(suffix.value)))) return [];
    const label = text(link);
    return alternatives.includes(label) && link.url === `plans/${label}/README.md` ? [label] : [];
  });
  const selected = declarations.length === 1 ? declarations[0] : undefined;
  if (selected === undefined || decision.length !== 1) report(decisionPath, 'DesignSelectionInvalid', 'Decision must contain only one explicit Selected: [slug](plans/slug/README.md) declaration');
  if (expectedSelection !== undefined && selected !== expectedSelection) report(decisionPath, 'DesignSelectionConflict', `DECISION must select ${expectedSelection}`);
  const rationaleNodes = section(decisionPath, decisionNodes, ['Rationale', '依据']);
  const rationale = rationaleNodes.filter(node => node.type === 'paragraph' || node.type === 'list').map(node => raw(sources.get(decisionPath) ?? '', node)).join('\n\n');
  for (const [label, content] of [['Rationale', rationaleNodes], ['Rejected Options', section(decisionPath, decisionNodes, ['Rejected Options', '否决项'])], ['Residual Risks', section(decisionPath, decisionNodes, ['Residual Risks', '遗留风险'])]] as const) {
    if (!authored(content.filter(node => node.type === 'paragraph' || node.type === 'list').map(text).join('\n'))) report(decisionPath, 'DesignDecisionIncomplete', `${label} needs authored explanation`);
  }
  const chosen = candidates.find(candidate => candidate.plan === (expectedSelection ?? selected));
  if (chosen) {
    for (const item of limits) if (chosen.limits[item.id] !== 'satisfied') report(decisionPath, 'DesignLimitUnsatisfied', `${chosen.plan} must satisfy ${item.id} before selection`);
    for (const item of goals) if (chosen.goals[item.id] !== 'satisfied') {
      const pattern = new RegExp(`^${item.id}[:：]\\s*(.+)$`, 'u');
      if (!rationaleNodes.some(node => node.type === 'paragraph' && authored(pattern.exec(text(node))?.[1] ?? ''))) report(decisionPath, 'DesignGoalGapUnexplained', `Rationale must explain ${item.id} in its own ${item.id}: paragraph`);
    }
  }
  return { findings, candidates, selected, rationale };
}

/** Only recognized table layout and ATX heading padding are rewritten. */
export function formatDesignMarkdown(source: string): string {
  const edits: { start: number; end: number; replacement: string }[] = [];
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  for (const node of fromMarkdown(source).children) {
    let replacement: string | undefined;
    if (node.type === 'heading' && node.depth === 2 && node.children.every(child => child.type === 'text')) {
      const current = raw(source, node);
      const normalized = current.replace(/^ {0,3}##[ \t]+/u, '## ').replace(/[ \t]+$/u, '');
      if (/^ {0,3}##[ \t]/u.test(current) && markdownAnchor(current) === markdownAnchor(normalized)) replacement = normalized;
    }
    const rows = table(source, node);
    if (rows) replacement = rows.map(row => `| ${row.join(' | ')} |`).join(newline);
    if (replacement !== undefined && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) edits.push({ start: node.position.start.offset, end: node.position.end.offset, replacement });
  }
  let result = source;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}
