import type { Nodes, ListItem, Paragraph } from 'mdast';
import { fromMarkdown } from './markdown-parser.js';
import { decodeDocumentSource } from './document-codec.js';
import { DOCUMENT_NAME_PATTERN } from './document-name.js';
import { ConcordError, type Finding } from './shared.js';

export interface UseCaseStep { readonly id: string; readonly ordinal: number; readonly line: number; readonly endLine: number; readonly listOrdinal: number }
export interface RootOrderedList { readonly ordinal: number; readonly line: number; readonly endLine: number; readonly items: number; readonly marked: number }
export interface StepMarkerRange { readonly line: number; readonly startColumn: number; readonly endColumn: number }

/** Mask metadata without moving any body offsets or line numbers. */
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#编译管线
export function markdownBody(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, value => value.replace(/[^\r\n]/gu, ' '));
}

export function markdownAnchor(line: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
  if (heading === undefined) return undefined;
  const explicit = /\s+\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*$/u.exec(heading)?.[1];
  if (explicit !== undefined) return explicit;
  if (heading.includes('{#')) return undefined;
  return heading.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}\s-]/gu, '').replace(/\s/gu, '-');
}

export function headingAnchors(source: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const add = (value: string) => { anchors.add(value); anchors.add(value.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '')); };
  const visit = (node: Nodes): void => {
    if (node.type === 'heading') {
      const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
      const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(raw)?.[1];
      if (heading === undefined) return;
      const explicit = /\s+\{#([^{}\s]+)\}\s*$/u.exec(heading)?.[1];
      if (explicit !== undefined) add(explicit);
      const slug = markdownAnchor(`## ${heading.replace(/\s+\{#[^{}\s]+\}\s*$/u, '')}`);
      if (slug !== undefined) add(slug);
    } else if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(markdownBody(source)));
  return anchors;
}
// @concord-end

export interface StepItem { readonly item: ListItem; readonly paragraph: Paragraph; readonly listOrdinal: number; readonly marker?: { readonly id: string; readonly start: number; readonly end: number; readonly range: StepMarkerRange } }

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
export function inspectSteps(path: string, source: string) {
  let owner: ReturnType<typeof decodeDocumentSource>;
  try { owner = decodeDocumentSource(path, source); }
  catch (cause) {
    return { steps: [], lists: [], markers: [], items: [], findings: [{ code: cause instanceof ConcordError ? cause.code : 'InvalidSteps', path, message: cause instanceof Error ? cause.message : String(cause) }] as Finding[] };
  }
  const useCase = owner?.metadata.kind === 'use-case';
  const tree = fromMarkdown(markdownBody(source));
  const steps: UseCaseStep[] = [], lists: RootOrderedList[] = [], markers: StepMarkerRange[] = [], findings: Finding[] = [], items: StepItem[] = [];
  const occupied = new Set(headingAnchors(source));
  const visit = (node: Nodes, ancestors: readonly Nodes[]): void => {
    if (node.type === 'paragraph') {
      const last = node.children.at(-1);
      if (last?.type !== 'text' || last.position === undefined) return;
      const tags: string[] = [];
      for (const child of node.children) if (child.type === 'html') {
        const tag = /^<(\/?)([a-z][a-z0-9-]*)\b/iu.exec(child.value);
        if (tag === null || /\/\s*>$/u.test(child.value)) continue;
        const name = tag[2]!.toLowerCase();
        if (tag[1] === '/') { const at = tags.lastIndexOf(name); if (at >= 0) tags.splice(at); }
        else if (!['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(name)) tags.push(name);
      }
      if (tags.length) return;
      const end = last.position.end.offset!;
      const raw = source.slice(last.position.start.offset, end);
      const match = /([ \t]+)\{#([^{}\s]+)\}$/u.exec(raw);
      if (match === null) return;
      const parent = ancestors.at(-1), list = ancestors.at(-2);
      const rootList = useCase && parent?.type === 'listItem' && list?.type === 'list' && list.ordered && ancestors.at(-3)?.type === 'root' && parent.children[0] === node;
      if (!rootList || !DOCUMENT_NAME_PATTERN.test(match[2]!)) {
        findings.push({ code: 'InvalidStepPosition', path, line: last.position.end.line, message: 'Step markers require a valid document name at the end of the first paragraph of a root ordered Use Case item' });
        return;
      }
      const id = match[2]!;
      const lineStart = source.lastIndexOf('\n', end - 1) + 1;
      const range = { line: last.position.end.line, startColumn: end - lineStart - match[0].length, endColumn: end - lineStart };
      markers.push(range);
      const entry = items.find(entry => entry.paragraph === node)!;
      items[items.indexOf(entry)] = { ...entry, marker: { id, start: end - match[0].length, end, range } };
      if (occupied.has(id)) findings.push({ code: 'DuplicateAnchor', path, line: range.line, message: `Step anchor ${id} conflicts with another step or heading anchor` });
      occupied.add(id);
      steps.push({ id, ordinal: steps.length + 1, line: parent.position!.start.line, endLine: parent.position!.end.line, listOrdinal: entry.listOrdinal });
    } else if ('children' in node) {
      if (node.type === 'list' && node.ordered && ancestors.at(-1)?.type === 'root' && useCase) {
        const ordinal = lists.length + 1;
        lists.push({ ordinal, line: node.position!.start.line, endLine: node.position!.end.line, items: node.children.length, marked: 0 });
        for (const item of node.children) if (item.children[0]?.type === 'paragraph') items.push({ item, paragraph: item.children[0], listOrdinal: ordinal });
      }
      node.children.forEach(child => visit(child, [...ancestors, node]));
    }
  };
  visit(tree, []);
  return { steps, lists: lists.map(list => ({ ...list, marked: steps.filter(step => step.listOrdinal === list.ordinal).length })), markers, findings, items };
}

export function extractSteps(path: string, source: string): { readonly steps: readonly UseCaseStep[]; readonly lists: readonly RootOrderedList[]; readonly markers: readonly StepMarkerRange[]; readonly findings: readonly Finding[] } {
  const { steps, lists, markers, findings } = inspectSteps(path, source);
  return { steps, lists, markers, findings };
}
// @concord-end
