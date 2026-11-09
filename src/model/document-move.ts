// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
import { isScalar, parseDocument } from 'yaml';
import { ConcordError, type Change } from './shared.ts';

export interface DocumentMove { readonly from: string; readonly to: string }
export interface DocumentMoveChange extends Change { readonly encoding?: 'base64' }
export interface DocumentMovePlan {
  readonly from: string;
  readonly to: string;
  readonly moves: readonly DocumentMove[];
  readonly changes: readonly DocumentMoveChange[];
  readonly inputsDigest: string;
}

export function rewriteMarkerTargets(source: string, markers: readonly { readonly line: number; readonly reference: string; readonly family: string }[], map: (target: string) => string): string {
  const lines = source.split(/(?<=\n)/u);
  for (const marker of markers) {
    const next = map(marker.reference);
    if (next === marker.reference) continue;
    const line = lines[marker.line - 1]!;
    const start = line.indexOf(marker.reference, line.indexOf(`@${marker.family}`) + marker.family.length + 1);
    if (start < 0) throw new ConcordError('ReferenceScanIncomplete', 'Cannot locate parsed reference');
    lines[marker.line - 1] = line.slice(0, start) + next + line.slice(start + marker.reference.length);
  }
  return lines.join('');
}

/** YAML owns the range; replacing its scalar retains comments, spacing and all other fields. */
export function moveRelationTargets(source: string, targets: readonly string[], map: (target: string) => string): string {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!header) return source;
  const yaml = parseDocument(header[1]!, { uniqueKeys: true, merge: false });
  const offset = source.indexOf('\n') + 1;
  const replacements: { start: number; end: number; text: string }[] = [];
  targets.forEach((target, index) => {
    const next = map(target);
    if (next === target) return;
    const node = yaml.getIn(['relations', index, 'target'], true);
    if (!isScalar(node) || node.value !== target || !node.range) throw new ConcordError('InvalidData', 'Cannot locate relation target');
    const raw = header[1]!.slice(node.range[0], node.range[1]);
    const text = raw.startsWith('"') ? JSON.stringify(next) : raw.startsWith("'") ? `'${next.replaceAll("'", "''")}'` : next;
    replacements.push({ start: offset + node.range[0], end: offset + node.range[1], text });
  });
  for (const item of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, item.start) + item.text + source.slice(item.end);
  return source;
}
