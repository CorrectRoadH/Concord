// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md#writingmd
import { Schema } from 'effect';
import { fromMarkdown } from './markdown-parser.ts';
import { WritingPolicySchema, type WritingPolicy, type BannedTerm } from './writing-schema.ts';
import { canonicalPath } from './path-rules.ts';
import type { Nodes } from 'mdast';
const plain = (node: Nodes): string => node.type === 'text' || node.type === 'inlineCode' ? node.value : 'children' in node ? node.children.map(plain).join('') : '';
const list = (value: string): string[] => value.split(/[、,，]/u).map(item => item.trim()).filter(Boolean);
function cells(source: string, inline = true): string[] {
  const cells: string[] = []; let cell = '';
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\' && index + 1 < source.length) { cell += source[index]! + source[index + 1]!; index++; }
    else if (source[index] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += source[index];
  }
  cells.push(cell.trim());
  if (cells[0] === '') cells.shift(); if (cells.at(-1) === '' && cells.length > 5) cells.pop();
  return inline ? cells.map(cell => fromMarkdown(cell).children.map(plain).join('')) : cells;
}
export function parseWritingPolicy(source: string, path = 'docs/writing.md'): WritingPolicy {
  const invalid = (line: number, message: string): never => { throw new Error(`line ${line}: ${message}`); };
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source)) invalid(1, 'Writing rules must not have frontmatter');
  const nodes = fromMarkdown(source).children;
  const titles = nodes.filter(node => node.type === 'heading' && node.depth === 1);
  if (titles.length !== 1 || nodes[0] !== titles[0]) invalid(1, 'Writing rules require one initial H1');
  const policy: { roots?: string[]; sentenceLength?: number; paragraphLength?: number; bannedTerms: BannedTerm[] } = { bannedTerms: [] };
  const first = nodes[1];
  if (first?.type === 'paragraph') {
    const text = plain(first);
    const sentence = /句子不超过\s*([0-9]+)\s*个字符/u.exec(text), paragraph = /段落不超过\s*([0-9]+)\s*个字符/u.exec(text);
    if (text.includes('句子不超过') && !sentence || text.includes('段落不超过') && !paragraph) invalid(first.position!.start.line, 'Length limits must be positive integer character counts');
    if (sentence) policy.sentenceLength = Number(sentence[1]); if (paragraph) policy.paragraphLength = Number(paragraph[1]);
  }
  const headings = nodes.filter(node => node.type === 'heading' && node.depth === 2);
  const sections = new Set<string>();
  for (const heading of headings) {
    const name = plain(heading), line = heading.position!.start.line;
    if (!['不用的词', '检查范围'].includes(name) || sections.has(name)) invalid(line, `Unknown or duplicate section: ${name}`);
    sections.add(name);
    const start = heading.position!.end.line;
    const next = nodes.find(node => node.type === 'heading' && node.depth <= 2 && node.position!.start.line > line)?.position!.start.line ?? source.split('\n').length + 1;
    const lines = source.split(/\r?\n/u).slice(start, next - 1).map((text, index) => ({ text, line: start + index + 1 })).filter(item => item.text.trim());
    if (name === '检查范围') {
      if (path !== 'docs/writing.md') invalid(line, 'Only docs/writing.md may declare the checking roots');
      const roots = lines.map(item => {
        const match = /^\s*[-*+]\s+(.+?)\s*$/u.exec(item.text);
        if (!match) return invalid(item.line, 'Checking roots must be a Markdown list');
        return fromMarkdown(match[1]!).children.map(plain).join('');
      });
      if (!roots.length) invalid(line, 'Checking roots cannot be empty'); policy.roots = roots;
    } else {
      if (lines.length < 2 || JSON.stringify(cells(lines[0]!.text)) !== JSON.stringify(['词', '改成', '为什么', '只在', '例外']) || cells(lines[1]!.text, false).length !== 5 || !cells(lines[1]!.text, false).every(cell => /^:?-{3,}:?$/u.test(cell))) invalid(line, 'Banned terms require the five-column table 词、改成、为什么、只在、例外');
      for (const row of lines.slice(2)) {
        const values = cells(row.text);
        if (values.length !== 5 || values.slice(0, 3).some(value => !value.trim())) invalid(row.line, 'Each banned term needs five cells and nonempty term, replacement and reason');
        const [term, use, why, roots, allowIn] = values;
        policy.bannedTerms.push({ term: term!, use: use!, why: why!, ...(roots ? { roots: list(roots) } : {}), ...(allowIn ? { allowIn: list(allowIn) } : {}) });
      }
    }
  }
  const names = new Set<string>();
  for (const ban of policy.bannedTerms) {
    const key = ban.term.toLocaleLowerCase(); if (names.has(key)) invalid(1, `Duplicate banned term: ${ban.term}`); names.add(key);
    for (const word of ban.allowIn ?? []) if (word.length <= ban.term.length || !word.toLocaleLowerCase().includes(ban.term.toLocaleLowerCase())) invalid(1, `Exception must contain a longer occurrence of ${ban.term}`);
  }
  for (const value of [...(policy.roots ?? []), ...policy.bannedTerms.flatMap(ban => ban.roots ?? [])]) {
    try { canonicalPath(value); if (value.split('/').some(part => ['.git', 'node_modules', '_template'].includes(part))) throw new Error('Excluded path'); }
    catch { invalid(1, `Unsafe writing path: ${value}`); }
  }
  try { return Schema.decodeUnknownSync(WritingPolicySchema, { onExcessProperty: 'error' })(policy); }
  catch (cause) { return invalid(first?.position?.start.line ?? 1, String(cause)); }
}
export function renderWritingPolicy(policy: WritingPolicy): string {
  const cell = (value: string) => value.replaceAll('\\', '\\\\').replace(/[`*_\[\]<>]/gu, char => `\\${char}`).replaceAll('|', '\\|').replace(/[\r\n]+/gu, ' ');
  const limits = [policy.sentenceLength === undefined ? '' : `句子不超过 ${policy.sentenceLength} 个字符`, policy.paragraphLength === undefined ? '' : `段落不超过 ${policy.paragraphLength} 个字符`].filter(Boolean).join('，');
  return `# 写作规则\n\n${limits ? `${limits}。\n\n` : ''}## 不用的词\n\n| 词 | 改成 | 为什么 | 只在 | 例外 |\n| --- | --- | --- | --- | --- |\n${policy.bannedTerms.map(ban => `| ${[ban.term, ban.use, ban.why, (ban.roots ?? []).join('、'), (ban.allowIn ?? []).join('、')].map(cell).join(' | ')} |\n`).join('')}${policy.roots ? `\n## 检查范围\n\n${policy.roots.map(root => `- ${root}\n`).join('')}` : ''}`;
}
