// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/compare-design-plans.md
import { posix } from 'node:path';
import { fromMarkdown } from './markdown-parser.js';
import { readDesignPlanPaths } from './document-layout.js';
import { ConcordError, type DocumentRecord, type Repository } from './shared.js';

/** Selected and Deferred are declarations in the root Decision section only. */
export function designState(source: string, base: string, entries: ReadonlyMap<string, string>) {
  const nodes = fromMarkdown(source).children;
  let section = '';
  let selected: string | undefined;
  let deferred: string | undefined;
  const rationale: string[] = [];
  for (const node of nodes) {
    if (node.type === 'heading' && node.depth <= 2) {
      section = node.depth === 2 ? node.children.map(child => child.type === 'text' ? child.value : '').join('') : '';
      continue;
    }
    if (['Rationale', '依据'].includes(section)) rationale.push(source.slice(node.position!.start.offset, node.position!.end.offset));
    if (!['Decision', '定案'].includes(section) || node.type !== 'paragraph') continue;
    const first = node.children[0];
    if (first?.type !== 'text') continue;
    if (/^Selected:/u.test(first.value)) {
      const link = node.children[1];
      if (!/^Selected:\s*$/u.test(first.value) || link?.type !== 'link' || node.children.length > 3 || (node.children[2] !== undefined && (node.children[2].type !== 'text' || !/^[。.]?$/u.test(node.children[2].value)))) throw new ConcordError('DesignSelectionInvalid', 'Selected requires one direct Plan link');
      const name = link.children.map(child => child.type === 'text' ? child.value : '').join('');
      const entry = entries.get(name);
      if (entry === undefined) throw new ConcordError('DesignPlanNotFound', `Selected Plan does not exist: ${name}`);
      if (link.url !== posix.relative(base, entry)) throw new ConcordError('DesignSelectionInvalid', `Selected must link ${entry}`);
      if (selected !== undefined) throw new ConcordError('DesignSelectionInvalid', 'Multiple Selected declarations');
      selected = name;
    }
    if (/^Deferred:/u.test(first.value)) {
      const reason = /^Deferred:\s*(.+)$/u.exec(first.value)?.[1];
      if (reason === undefined || deferred !== undefined) throw new ConcordError('DesignSelectionInvalid', 'Deferred requires one reason');
      deferred = reason;
    }
  }
  if (selected !== undefined && deferred !== undefined) throw new ConcordError('DesignSelectionConflict', 'Design cannot be selected and deferred');
  return { selected, deferred, rationale: rationale.join('\n\n') };
}

/** Keep the parser cache byte-local; filesystem-derived state belongs to this snapshot. */
export function deriveDesignRecord(repo: Pick<Repository, 'root' | 'read' | 'files'>, record: DocumentRecord): DocumentRecord {
  if (record.metadata.kind !== 'design') return record;
  const base = posix.dirname(record.path);
  repo.files(`${base}/plans`);
  const entries = readDesignPlanPaths(repo.root, base);
  for (const entry of entries.values()) repo.read(entry);
  const state = designState(repo.read(`${base}/DECISION.md`) ?? '', base, entries);
  return { ...record, metadata: { ...record.metadata, alternatives: [...entries.keys()],
    ...(state.selected === undefined ? {} : { decision: { selected: state.selected, reason: state.rationale || 'Selected in DECISION', targets: [] } }),
    ...(state.deferred === undefined ? {} : { deferral: { reason: state.deferred } }),
  } };
}

export function writeDesignDeclaration(source: string, declaration: string, reason?: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let section = '';
  const removals: { start: number; end: number }[] = [];
  for (const node of fromMarkdown(source).children) {
    if (node.type === 'heading' && node.depth <= 2) section = node.depth === 2 ? node.children.map(child => child.type === 'text' ? child.value : '').join('') : '';
    if (['Decision', '定案'].includes(section) && node.type === 'paragraph' && node.children[0]?.type === 'text' && /^(?:Selected|Deferred):/u.test(node.children[0].value)) removals.push({ start: node.position!.start.offset!, end: node.position!.end.offset! });
  }
  let result = source;
  for (const range of removals.reverse()) result = `${result.slice(0, range.start)}${result.slice(range.end)}`;
  const insert = (names: readonly string[], content: string): void => {
    const heading = fromMarkdown(result).children.find(node => node.type === 'heading' && node.depth === 2 && names.includes(node.children.map(child => child.type === 'text' ? child.value : '').join('')));
    if (heading === undefined) result += `${newline}## ${names[0]}${newline}${newline}${content}${newline}`;
    else {
      const end = heading.position!.end.offset!;
      result = `${result.slice(0, end)}${newline}${newline}${content}${result.slice(end)}`;
    }
  };
  insert(['Decision', '定案'], declaration);
  if (reason !== undefined && !result.includes(reason)) {
    insert(['Rationale', '依据'], reason);
  }
  return result;
}
