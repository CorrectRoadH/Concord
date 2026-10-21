// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/apply-controlled-writing.md
import { objectDigest } from './shared.js';
import type { Nodes } from 'mdast';
import { fromMarkdown } from './markdown-parser.js';
import type { WritingFinding } from './writing.js';
import { normalizeWriting, writingBudget, type EffectiveControlled } from './writing-controlled-policy.js';

interface Unit { char: string; start: number; end: number; code?: boolean }
interface Block { units: Unit[]; procedural: boolean; line: number }
interface Token { text: string; start: number; end: number; latin: boolean }
interface Range { start: number; end: number }
interface Match extends Range { text: string }
interface MatcherNode { next: Map<string, number>; fail: number; outputs: string[] }

// Failure links avoid rescanning the paragraph once for every vocabulary entry.
class Matcher {
  readonly nodes: MatcherNode[] = [{ next: new Map(), fail: 0, outputs: [] }];
  constructor(words: readonly string[]) {
    for (const word of words) {
      let node = 0;
      for (const char of normalizeWriting(word)) {
        let next = this.nodes[node]!.next.get(char);
        if (next === undefined) { next = this.nodes.length; this.nodes[node]!.next.set(char, next); this.nodes.push({ next: new Map(), fail: 0, outputs: [] }); }
        node = next;
      }
      this.nodes[node]!.outputs.push(normalizeWriting(word));
    }
    const queue = [...this.nodes[0]!.next.values()];
    for (let index = 0; index < queue.length; index++) {
      const at = queue[index]!;
      for (const [char, child] of this.nodes[at]!.next) {
        let fail = this.nodes[at]!.fail;
        while (fail && !this.nodes[fail]!.next.has(char)) fail = this.nodes[fail]!.fail;
        this.nodes[child]!.fail = this.nodes[fail]!.next.get(char) ?? 0;
        this.nodes[child]!.outputs.push(...this.nodes[this.nodes[child]!.fail]!.outputs);
        queue.push(child);
      }
    }
  }
  scan(units: readonly Unit[], candidate: () => void): Match[] {
    let at = 0, offset = 0;
    const matches: Match[] = [];
    for (const unit of units) {
      if (unit.code) { at = 0; offset += unit.char.length; continue; }
      for (const char of unit.char) {
        while (at && !this.nodes[at]!.next.has(char)) at = this.nodes[at]!.fail;
        at = this.nodes[at]!.next.get(char) ?? 0;
        offset += char.length;
        for (const text of this.nodes[at]!.outputs) { candidate(); matches.push({ start: offset - text.length, end: offset, text }); }
      }
    }
    return matches;
  }
}
const compiled = new Map<string, Matcher>();
function matcher(words: readonly string[]): Matcher {
  const key = JSON.stringify(words);
  let value = compiled.get(key);
  if (!value) { value = new Matcher(words); if (compiled.size >= 128) compiled.delete(compiled.keys().next().value!); compiled.set(key, value); }
  return value;
}
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
function normalized(units: readonly Unit[]): Unit[] {
  const result: Unit[] = [];
  for (let begin = 0; begin < units.length;) {
    if (units[begin]!.code) { result.push(units[begin++]!); continue; }
    let end = begin;
    while (end < units.length && !units[end]!.code) end++;
    const text = units.slice(begin, end).map(unit => unit.char).join('');
    let cursor = begin, offset = 0;
    for (const segment of graphemes.segment(text)) {
      const first = units[cursor]!;
      const limit = segment.index + segment.segment.length;
      while (cursor < end && offset < limit) offset += units[cursor++]!.char.length;
      const last = units[cursor - 1]!;
      for (const char of normalizeWriting(segment.segment)) result.push({ char, start: first.start, end: last.end });
    }
    begin = end;
  }
  return result;
}
function blocks(source: string, mdx: boolean): Block[] {
  const result: Block[] = [];
  function inline(node: Nodes): Unit[] {
    const start = node.position?.start.offset ?? 0, end = node.position?.end.offset ?? start;
    if (node.type === 'inlineCode') return [{ char: '\uFFFC', start, end, code: true }];
    if (node.type === 'text') {
      const units: Unit[] = [];
      let cursor = start;
      // mdast positions refer to the authored source, including Markdown escapes.
      for (let index = 0; index < node.value.length;) {
        const entity = source[cursor] === '&' ? /^&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]+);/u.exec(source.slice(cursor, Math.min(cursor + 64, end)))?.[0] : undefined;
        if (entity) {
          const parsed = fromMarkdown(entity).children[0];
          const decoded = parsed?.type === 'paragraph' ? parsed.children.flatMap(child => child.type === 'text' ? [child.value] : []).join('') : entity;
          if (decoded !== entity && node.value.startsWith(decoded, index)) {
            for (const char of decoded) units.push({ char, start: cursor, end: cursor + entity.length });
            cursor += entity.length; index += decoded.length; continue;
          }
        }
        const char = String.fromCodePoint(node.value.codePointAt(index)!);
        const found = source.indexOf(char, cursor);
        const at = found >= cursor && found < end ? found : cursor;
        units.push({ char: char === '\n' ? ' ' : char, start: at, end: Math.min(end, at + char.length) }); cursor = Math.min(end, at + char.length); index += char.length;
      }
      return units;
    }
    if (node.type === 'break') return [{ char: ' ', start, end }];
    if (node.type === 'image' || node.type === 'imageReference' || node.type === 'html') return [];
    return 'children' in node ? node.children.flatMap(inline) : [];
  }
  function visit(node: Nodes, ordered = false, quote = false): void {
    if (['heading', 'code', 'html', 'table'].includes(node.type)) return;
    if (node.type === 'paragraph') {
      let units = inline(node);
      if (mdx) {
        let depth = 0;
        units = units.filter(unit => { if (!unit.code && unit.char === '{') { depth++; return false; } if (!unit.code && unit.char === '}' && depth) { depth--; return false; } return depth === 0; });
      }
      result.push({ units, procedural: ordered && !quote, line: node.position?.start.line ?? 1 }); return;
    }
    if ('children' in node) for (const child of node.children) visit(child, node.type === 'list' ? node.ordered === true : ordered, quote || node.type === 'blockquote');
  }
  // The shared legacy parser intentionally has no GFM extension. Mask table
  // lines with equal-width whitespace before controlled paragraph parsing.
  const lines = source.split('\n');
  for (let index = 1; index < lines.length; index++) if (lines[index - 1]!.includes('|') && /^\s*\|?\s*:?-+:?\s*\|(?:\s*:?-+:?\s*\|?)+\s*$/u.test(lines[index]!)) {
    lines[index - 1] = ' '.repeat(lines[index - 1]!.length);
    lines[index] = ' '.repeat(lines[index]!.length);
    while (index + 1 < lines.length && lines[index + 1]!.includes('|') && lines[index + 1]!.trim()) { index++; lines[index] = ' '.repeat(lines[index]!.length); }
  }
  visit(fromMarkdown(lines.join('\n')));
  return result;
}
const tokenPattern = /\p{Script=Han}|\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*|\p{Nd}+(?:\.\p{Nd}+)*|(?:(?!\p{Script=Han}|\p{Script=Latin})\p{L})(?:(?!\p{Script=Han}|\p{Script=Latin})[\p{L}\p{M}])*/gu;
function tokens(units: readonly Unit[]): Token[] {
  const result: Token[] = [];
  let text = '', offset = 0;
  const flush = (): void => {
    for (const match of text.matchAll(tokenPattern)) result.push({ text: match[0], start: offset + match.index, end: offset + match.index + match[0].length, latin: /^\p{Script=Latin}/u.test(match[0]) });
    offset += text.length; text = '';
  };
  for (const unit of units) {
    if (unit.code) { flush(); result.push({ text: unit.char, start: offset, end: offset + unit.char.length, latin: false }); offset += unit.char.length; }
    else text += unit.char;
  }
  flush(); return result;
}
function sentences(units: readonly Unit[]): Unit[][] {
  const text = units.map(u => u.char).join('');
  const protectedDots = new Set<number>();
  for (const match of text.matchAll(/\b(?:e\.g\.|i\.e\.|Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|vs\.|etc\.|(?:[A-Za-z]\.){2,})/giu)) for (let i = 0; i < match[0].length; i++) if (match[0][i] === '.') protectedDots.add(match.index + i);
  const result: Unit[][] = [];
  let begin = 0, offset = 0;
  const push = (end: number): void => { const sentence = units.slice(begin, end); if (tokens(sentence).length) result.push(sentence); begin = end; };
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!, at = offset;
    offset += unit.char.length;
    if (unit.code) continue;
    let terminal = /[。！？!?]/u.test(unit.char);
    if (unit.char === '.' && !protectedDots.has(at)) {
      const decimal = /\p{Nd}/u.test(units[index - 1]?.char ?? '') && /\p{Nd}/u.test(units[index + 1]?.char ?? '');
      terminal = !decimal && (units[index + 1]?.char === '.' || index + 1 === units.length || /\s|["'”’）)\]]/u.test(units[index + 1]?.char ?? ''));
    }
    if (!terminal) continue;
    while (index + 1 < units.length && !units[index + 1]!.code && /[。！？!?."'”’）)\]]/u.test(units[index + 1]!.char)) { offset += units[++index]!.char.length; }
    push(index + 1);
  }
  push(units.length); return result;
}
function languageOf(units: readonly Unit[], configured: unknown): 'zh' | 'en' {
  if (configured === 'zh' || configured === 'en') return configured;
  let letters = 0, han = 0;
  for (const unit of units) if (!unit.code && /\p{L}/u.test(unit.char)) { letters++; if (/\p{Script=Han}/u.test(unit.char)) han++; }
  return letters && han / letters >= .5 ? 'zh' : 'en';
}
function union(ranges: Range[]): Range[] {
  const ends = new Map<number, number>();
  let extent = 0;
  for (const range of ranges) { ends.set(range.start, Math.max(ends.get(range.start) ?? 0, range.end)); extent = Math.max(extent, range.start + 1); }
  const result: Range[] = [];
  for (let start = 0; start < extent; start++) {
    const end = ends.get(start);
    if (end === undefined) continue;
    const previous = result.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else result.push({ start, end });
  }
  return result;
}
function overlaps(range: Range, ranges: readonly Range[]): boolean {
  let low = 0, high = ranges.length;
  while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle]!.end <= range.start) low = middle + 1; else high = middle; }
  return low < ranges.length && ranges[low]!.start < range.end;
}
function longest(matches: Match[]): Match[] {
  const at = new Map<number, Match>();
  let extent = 0;
  for (const match of matches) { if (match.end > (at.get(match.start)?.end ?? -1)) at.set(match.start, match); extent = Math.max(extent, match.start + 1); }
  const selected: Match[] = [];
  for (let start = 0; start < extent; start++) { const match = at.get(start); if (match) { selected.push(match); start = match.end - 1; } }
  return selected;
}
interface CompiledPolicy { matchers: Map<string, Matcher>; sets: Map<string, Set<string>> }
const policyCompilations = new Map<string, CompiledPolicy>();
const policyIdentities = new WeakMap<EffectiveControlled, CompiledPolicy>();
function compilePolicy(policy: EffectiveControlled): CompiledPolicy {
  let compiled = policyIdentities.get(policy);
  if (!compiled) {
    const key = objectDigest([...policy]);
    compiled = policyCompilations.get(key);
    if (!compiled) {
      compiled = { matchers: new Map(), sets: new Map() };
      if (policyCompilations.size >= 32) policyCompilations.delete(policyCompilations.keys().next().value!);
      policyCompilations.set(key, compiled);
    }
    policyIdentities.set(policy, compiled);
  }
  return compiled;
}
export function checkControlled(file: string, authored: string, original: string, policy: EffectiveControlled, findings: WritingFinding[]): void {
  const get = (key: string) => policy.get(key)?.value;
  const words = (key: string): readonly string[] => Array.isArray(get(key)) ? get(key) as string[] : [];
  const compiled = compilePolicy(policy);
  const matchTable = (key: string): Matcher => { let result = compiled.matchers.get(key); if (!result) { result = matcher(words(key)); compiled.matchers.set(key, result); } return result; };
  const wordSet = (key: string): Set<string> => {
    let result = compiled.sets.get(key);
    if (!result) {
      const values = key === 'procedural/verbs/en' ? (get(key) as readonly { lemma: string; forms?: readonly string[] }[]).flatMap(verb => [verb.lemma, ...(verb.forms ?? [])]) : words(key);
      result = new Set(values.map(normalizeWriting)); compiled.sets.set(key, result);
    }
    return result;
  };
  const starts = [0]; for (let i = 0; i < original.length; i++) if (original[i] === '\n') starts.push(i + 1);
  const location = (offset: number) => { let low = 0, high = starts.length; while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid]! <= offset) low = mid; else high = mid; } return { line: low + 1, column: offset - starts[low]! }; };
  const descriptions = new WeakMap<readonly Unit[], { offsets: number[]; context: string; language: 'zh' | 'en' }>();
  const describe = (units: readonly Unit[]) => {
    let result = descriptions.get(units);
    if (!result) {
      const offsets = [0]; for (const unit of units) offsets.push(offsets.at(-1)! + unit.char.length);
      result = { offsets, context: units.map(unit => unit.char).join('').trim().slice(0, 240), language: languageOf(units, get('language')) }; descriptions.set(units, result);
    }
    return result;
  };
  for (const block of blocks(authored, /\.mdx$/iu.test(file))) {
    let candidates = 0;
    const candidate = () => { if (++candidates > 100000) writingBudget(`${file}:${block.line}: paragraph exceeds 100000 candidate intervals`); };
    const pieces = sentences(normalized(block.units));
    const emit = (rule: string, key: string, sentence: readonly Unit[], message: string, actual: number, limit?: number, matches?: readonly Match[], dependencies: string[] = []): void => {
      const source = policy.get(key)?.source;
      const sources = [key, 'language', ...dependencies].map(name => policy.get(name)?.source).filter((item): item is NonNullable<typeof item> => item !== undefined).filter((item, index, all) => all.findIndex(other => other.path === item.path && other.pointer === item.pointer) === index);
      const description = describe(sentence);
      const mapRange = (range: Range) => {
        const at = (offset: number): Unit | undefined => {
          let low = 0, high = sentence.length;
          while (low + 1 < high) { const middle = (low + high) >>> 1; if (description.offsets[middle]! <= offset) low = middle; else high = middle; }
          return sentence[low];
        };
        return { start: location(at(range.start)?.start ?? 0), end: location(at(range.end - 1)?.end ?? 0) };
      };
      const origin = matches?.length ? mapRange(matches[0]!).start : location(sentence.find(unit => unit.code || /\S/u.test(unit.char))?.start ?? starts[block.line - 1]!);
      findings.push({ file, ...origin, rule, message, context: description.context, source, sources, actual, ...(limit === undefined ? {} : { limit }), language: description.language, languagePolicy: get('language') ?? 'auto', ...(matches === undefined ? {} : { matches: matches.map(match => { const range = mapRange(match); const start = starts[range.start.line - 1]! + range.start.column, end = starts[range.end.line - 1]! + range.end.column; return { text: original.slice(start, end), ...range }; }) }) });
      if (findings.length > 10000) writingBudget('Writing report exceeds 10000 findings');
    };
    const count = get('paragraphSentences');
    if (typeof count === 'number' && pieces.length > count) emit('paragraphSentences', 'paragraphSentences', block.units, `Paragraph has ${pieces.length} sentences; maximum ${count}`, pieces.length, count);
    for (const sentence of pieces) {
      const language = describe(sentence).language, ts = tokens(sentence);
      const kind = block.procedural ? 'procedural' : 'descriptive', key = `sentence/${language}/${kind}`, limit = get(key);
      if (typeof limit === 'number' && ts.length > limit) emit(`${kind}SentenceLength`, key, sentence, `Sentence has ${ts.length} tokens; maximum ${limit} (${language})`, ts.length, limit);
      const exemptions = (rule: string): Range[] => {
        const starts = new Set(ts.map(token => token.start)), ends = new Set(ts.map(token => token.end));
        return union(matchTable(`${rule}/allowIn/${language}`).scan(sentence, candidate).filter(match => language === 'zh' || starts.has(match.start) && ends.has(match.end)));
      };
      if (block.procedural && (get('procedural/singleInstruction') === true || get('procedural/requireVerb') === true)) {
        const allowed = exemptions('procedural');
        const found = language === 'zh' ? matchTable('procedural/verbs/zh').scan(sentence, candidate) : ts.filter(token => token.latin && wordSet('procedural/verbs/en').has(token.text)).map(token => { candidate(); return token; });
        const matches = longest(found.filter(match => !overlaps(match, allowed)));
        const dependencies = [`procedural/verbs/${language}`, `procedural/allowIn/${language}`];
        if (get('procedural/singleInstruction') === true && matches.length > 1) emit('multipleInstructions', 'procedural/singleInstruction', sentence, '命中多个受控动作词', matches.length, 1, matches, dependencies);
        if (get('procedural/requireVerb') === true && matches.length === 0) emit('unapprovedProceduralVerb', 'procedural/requireVerb', sentence, '未命中项目受控动作词', 0, undefined, [], dependencies);
      }
      if (language === 'en' && get('approvedWords/enabled') === true) {
        const approved = wordSet('approvedWords/en'), allowed = exemptions('approvedWords');
        for (const token of ts) if (token.latin && !approved.has(token.text) && !overlaps(token, allowed)) { candidate(); emit('unapprovedWord', 'approvedWords/enabled', sentence, `Unapproved word: ${token.text}`, 1, undefined, [token], ['approvedWords/en', 'approvedWords/allowIn/en']); }
      }
      if (get(`passiveVoice/${language}`) === true) {
        const allowed = exemptions('passiveVoice');
        let matches: Match[];
        if (language === 'zh') matches = matcher(['被']).scan(sentence, candidate);
        else {
          const participles = wordSet('passiveVoice/participles');
          matches = [];
          for (let i = 0; i + 1 < ts.length; i++) if (/^(?:am|is|are|was|were|be|been|being)$/u.test(ts[i]!.text) && participles.has(ts[i + 1]!.text)) { candidate(); matches.push({ start: ts[i]!.start, end: ts[i + 1]!.end, text: `${ts[i]!.text} ${ts[i + 1]!.text}` }); }
        }
        for (const match of longest(matches.filter(match => !overlaps(match, allowed)))) emit('passiveVoice', `passiveVoice/${language}`, sentence, '命中被动形式候选', 1, undefined, [match], [`passiveVoice/allowIn/${language}`, ...(language === 'en' ? ['passiveVoice/participles'] : [])]);
      }
    }
  }
}
