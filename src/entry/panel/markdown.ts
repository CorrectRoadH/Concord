import type { Nodes } from 'mdast';
import stringWidth from 'string-width';
import { fromMarkdown, markdownBody, conceptSpellingKey, type WorkspaceConcept } from '../../model/index.js';

export interface PanelConcept extends WorkspaceConcept { readonly path: string; readonly digest: string }
export interface TerminalLine { readonly text: string; readonly literal?: boolean }
export interface PanelLink { readonly label: string; readonly target: string }
export interface TerminalMarkdown { readonly lines: readonly TerminalLine[]; readonly links: readonly PanelLink[]; readonly concepts: readonly PanelConcept[] }
/** Control sequences in repository text must never become terminal commands. */
export const terminalText = (value: string): string => value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|$))|[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu, '');
export function localTarget(documentPath: string, target: string, paths: ReadonlySet<string>): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(target)) return;
  const withoutAnchor = target.split('#')[0]!;
  let decoded: string;
  try { decoded = decodeURIComponent(withoutAnchor); } catch { return; }
  const parts = documentPath.split('/').slice(0, -1);
  if (!decoded) return paths.has(documentPath) ? documentPath : undefined;
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  const path = parts.join('/');
  return paths.has(path) ? path : undefined;
}
export function markdownToTerminal(source: string, documentPath: string, paths: ReadonlySet<string>, effectiveConcepts: readonly PanelConcept[] = []): TerminalMarkdown {
  const links: PanelLink[] = [], concepts: PanelConcept[] = [];
  const tree = fromMarkdown(markdownBody(source));
  const definitions = new Map(tree.children.filter(node => node.type === 'definition').map(node => [node.identifier.toLocaleLowerCase(), node.url]));
  const spellings = effectiveConcepts.flatMap(concept => [concept.term, ...concept.deprecated].map(term => ({ concept, term }))).sort((a, b) => b.term.length - a.term.length);
  const mark = (value: string): string => {
    let result = '';
    for (let at = 0; at < value.length;) {
      const found = spellings.find(({ term }) => conceptSpellingKey(value.slice(at, at + term.length)) === conceptSpellingKey(term)
        && (!/^[\x20-\x7e]+$/u.test(term) || !/[a-z0-9_]/iu.test(value[at - 1] ?? '') && !/[a-z0-9_]/iu.test(value[at + term.length] ?? '')));
      if (!found) { result += value[at]!; at++; continue; }
      const { concept, term } = found;
      let index = concepts.indexOf(concept);
      if (index < 0) { concepts.push(concept); index = concepts.length - 1; }
      result += `${value.slice(at, at + term.length)}〔概念${index + 1}${term === concept.term ? '' : `：弃用→${concept.term}`}〕`;
      at += term.length;
    }
    return terminalText(result);
  };
  const inline = (node: Nodes): string => {
    if (node.type === 'text') return mark(node.value);
    if (node.type === 'inlineCode') return '`' + terminalText(node.value) + '`';
    if (node.type === 'break') return '\n';
    if (node.type === 'image') return `[图片：${terminalText(node.alt ?? '')}] (${terminalText(node.url)})`;
    if (node.type === 'link') {
      const label = node.children.map(inline).join(''), target = localTarget(documentPath, node.url, paths);
      if (!target) return `${label} (${terminalText(node.url)})`;
      links.push({ label, target }); return `${label} [${links.length}]`;
    }
    if (node.type === 'linkReference') {
      const label = node.children.map(inline).join(''), url = definitions.get(node.identifier.toLocaleLowerCase());
      if (!url) return label;
      const target = localTarget(documentPath, url, paths);
      if (!target) return `${label} (${terminalText(url)})`;
      links.push({ label, target }); return `${label} [${links.length}]`;
    }
    if (node.type === 'html') return terminalText(node.value);
    if ('children' in node) return node.children.map(inline).join('');
    return '';
  };
  const block = (node: Nodes, indent = ''): TerminalLine[] => {
    if (node.type === 'code') return [
      { text: `${indent}[${terminalText(node.lang ?? '代码')}]` },
      ...node.value.split('\n').map(text => ({ text: indent + terminalText(text), literal: true })),
      ...(/^(?:mermaid|p5)(?:\b|$)/iu.test(node.lang ?? '') ? [{ text: `${indent}在 Web 中查看` }] : []), { text: '' },
    ];
    if (node.type === 'heading') return [{ text: indent + '#'.repeat(node.depth) + ' ' + node.children.map(inline).join('') }, { text: '' }];
    if (node.type === 'list') return node.children.flatMap((item, index) => {
      const prefix = node.ordered ? `${(node.start ?? 1) + index}. ` : '• ';
      const lines = item.children.flatMap(child => block(child, indent + ' '.repeat(prefix.length)));
      return lines.map((line, at) => at === 0 ? { ...line, text: indent + prefix + line.text.slice(indent.length + prefix.length) } : line);
    });
    if (node.type === 'blockquote') return node.children.flatMap(child => block(child, indent + '> '));
    if (node.type === 'thematicBreak') return [{ text: indent + '────' }];
    if (node.type === 'definition') return [];
    if (node.type === 'paragraph' || node.type === 'html') return [...inline(node).split('\n').map(text => ({ text: indent + text })), { text: '' }];
    if ('children' in node) return node.children.flatMap(child => block(child as Nodes, indent));
    return [];
  };
  return { lines: tree.children.flatMap(node => block(node)), links, concepts };
}
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
export function sliceColumns(value: string, start: number, columns: number): string {
  let position = 0, result = '';
  for (const { segment: character } of graphemes.segment(value)) {
    const width = stringWidth(character);
    if (position >= start && position + width <= start + columns) result += character;
    else if (width && position < start + columns && position + width > start) result += ' '.repeat(Math.min(position + width, start + columns) - Math.max(position, start));
    position += width;
  }
  return result;
}
export function wrapTerminalLine(line: TerminalLine, columns: number, horizontal = 0): string[] {
  if (line.literal) return [sliceColumns(line.text, horizontal, columns)];
  const result: string[] = []; let current = '', width = 0;
  for (const { segment: character } of graphemes.segment(line.text)) {
    const size = stringWidth(character);
    if (width + size > columns && current) { result.push(current); current = ''; width = 0; }
    current += character; width += size;
  }
  result.push(current);
  return result;
}
