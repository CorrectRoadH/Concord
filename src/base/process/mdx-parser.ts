import { createRequire } from "node:module";
import type { Nodes } from "mdast";
import type * as Esbuild from "esbuild";
import { ConcordError } from "../../model/shared.js";
import { fromMarkdown } from "../../model/index.js";


export let javascript: typeof Esbuild | undefined;


/** Mask MDX source while preserving Markdown children, offsets and original lines. */
export function mdxProse(source: string): string {
  const characters = source.split('');
  const mask = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (characters[i] !== '\n' && characters[i] !== '\r') characters[i] = ' ';
  };
  const maskConstruct = (start: number, end: number) => {
    mask(start, end);
    // A long inline tag/expression must not turn its Markdown sibling into
    // indented code. Keep a text boundary when prose follows on the same line.
    const lineEnd = source.indexOf('\n', end);
    if (source.slice(end, lineEnd < 0 ? source.length : lineEnd).trim() !== '') {
      characters[Math.max(start, source.lastIndexOf('\n', end - 1) + 1)] = '\u200B';
    }
  };
  const tags: { readonly name: string; readonly start: number }[] = [];
  const protectedRanges = new Map<number, number>();
  const protect = (node: Nodes): void => {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html' && node.value.startsWith('<!--')) {
      protectedRanges.set(node.position!.start.offset!, node.position!.end.offset!);
    } else if ('children' in node) node.children.forEach(protect);
  };
  protect(fromMarkdown(source));
  const parses = (code: string): boolean => {
    javascript ??= createRequire(import.meta.url)('esbuild') as typeof Esbuild;
    try { javascript.transformSync(code, { loader: 'jsx', logLevel: 'silent' }); return true; }
    catch (cause) {
      if (!(cause instanceof Error) || !('errors' in cause)) throw cause;
      return false;
    }
  };
  const invalid = (offset: number): never => { throw new ConcordError('InvalidMarkdownSource', `Cannot parse MDX source at line ${source.slice(0, offset).split('\n').length}`); };
  const expressionEnd = (start: number): number => {
    // Let the installed JavaScript parser handle nested braces, comments, strings,
    // regular expressions, templates and JSX, instead of duplicating its lexer.
    for (let end = source.indexOf('}', start + 1); end >= 0; end = source.indexOf('}', end + 1)) {
      if (parses(`const value = <>${source.slice(start, end + 1)}</>;`)) return end + 1;
    }
    return invalid(start);
  };
  for (let at = 0; at < source.length;) {
    const protectedEnd = protectedRanges.get(at);
    if (protectedEnd !== undefined) { at = protectedEnd; continue; }
    if (source.startsWith('<!--', at)) {
      const end = source.indexOf('-->', at + 4);
      mask(at, end < 0 ? source.length : end + 3); at = end < 0 ? source.length : end + 3; continue;
    }
    if ((at === 0 || source[at - 1] === '\n') && /^(?:import|export)(?:\s|\{)/u.test(source.slice(at))) {
      const boundaries = /\r?\n[ \t]*\r?\n|$/gu;
      boundaries.lastIndex = at;
      let found = false;
      for (let match = boundaries.exec(source); match !== null; match = boundaries.exec(source)) {
        const end = match.index;
        if (parses(source.slice(at, end))) { mask(at, end); at = end; found = true; break; }
        if (match[0] === '') break;
      }
      if (!found) invalid(at);
      continue;
    }
    if (source[at] === '\\') { at += 2; continue; }
    if (source[at] === '{') { const end = expressionEnd(at); maskConstruct(at, end); at = end; continue; }
    if (source[at] === '<' && !/^<[a-z][a-z0-9+.-]*:\/\//iu.test(source.slice(at)) && (source.startsWith('<>', at) || source.startsWith('</>', at) || /^<\/?[A-Za-z][\w.:-]*(?=[\s/>])/u.test(source.slice(at)))) {
      let end = at + 1, quote: string | undefined;
      for (; end < source.length; end++) {
        const char = source[end];
        if (quote !== undefined) { if (char === quote) quote = undefined; continue; }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === '{') { end = expressionEnd(end) - 1; continue; }
        if (char === '>') break;
      }
      if (end === source.length) invalid(at);
      const tag = source.slice(at, end + 1);
      const name = /^<\/?([\w.:-]+)/u.exec(tag)?.[1] ?? '';
      const closing = tag.startsWith('</');
      if (closing) {
        if (tags.at(-1)?.name !== name || !parses(`const value = <${name}>${tag};`)) invalid(at);
        tags.pop();
      } else {
        const selfClosing = /\/\s*>$/u.test(tag);
        if (!parses(`const value = ${tag}${selfClosing ? '' : `</${name}>`};`)) invalid(at);
        if (!selfClosing) tags.push({ name, start: at });
      }
      maskConstruct(at, end + 1); at = end + 1; continue;
    }
    at++;
  }
  if (tags.length > 0) invalid(tags[0]!.start);
  return characters.join('');
}
