// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
import { posix } from 'node:path';
import type { Nodes } from 'mdast';
import { ConcordError, fromMarkdown } from '../../model/index.ts';

/** Parsing selects references; lexical ranges change destinations without serializing Markdown. */
export function relocateMarkdown(source: string, from: string, to: string, map: (path: string) => string): string {
  const replacements: { start: number; end: number; text: string }[] = [];
  const unsupported = (): never => { throw new ConcordError('UnsupportedMarkdownLink', `Cannot safely replace a Markdown destination in ${from}`); };
  const masked = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, header => header.replace(/[^\r\n]/gu, ' '));
  const visit = (node: Nodes): void => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') {
      const url = node.url;
      if (!url || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/#])/u.test(url)) return;
      const hash = url.indexOf('#'), pathname = hash < 0 ? url : url.slice(0, hash);
      let decoded: string;
      try { decoded = decodeURIComponent(pathname); } catch { return unsupported(); }
      const target = posix.normalize(posix.join(posix.dirname(from), decoded));
      const mapped = map(target);
      if (mapped === target && from === to) return;
      const relative = posix.relative(posix.dirname(to), mapped) || '.';
      if (from !== to && mapped === target && posix.dirname(from) === posix.dirname(to)) return;
      let start = node.position?.start.offset;
      const finish = node.position?.end.offset;
      if (start === undefined || finish === undefined) return unsupported();
      if (node.type === 'definition') {
        const prefix = /^\s*\[(?:\\.|[^\]\\])*\]:\s*/u.exec(source.slice(start, finish))?.[0];
        if (prefix === undefined) return unsupported();
        start += prefix.length;
      } else if (node.type === 'image') {
        const prefix = /^!\[(?:\\.|[^\]\\])*\]\(\s*/u.exec(source.slice(start, finish))?.[0];
        if (prefix === undefined) return unsupported();
        start += prefix.length;
      } else {
        start = node.children.at(-1)?.position?.end.offset ?? start + 1;
        const prefix = /^\]\(\s*/u.exec(source.slice(start, finish))?.[0];
        if (prefix === undefined) return unsupported();
        start += prefix.length;
      }
      const angled = source[start] === '<';
      if (angled) start++;
      let end = start, depth = 0;
      for (; end < finish; end++) {
        const ch = source[end]!;
        if (ch === '\\') { end++; continue; }
        if (angled ? ch === '>' : /\s/u.test(ch)) break;
        if (!angled && ch === ')') { if (depth === 0) break; depth--; }
        if (!angled && ch === '(') depth++;
      }
      const raw = source.slice(start, end), parsed = fromMarkdown(`[x](${angled ? `<${raw}>` : raw})`).children[0];
      if (parsed?.type !== 'paragraph' || parsed.children[0]?.type !== 'link' || parsed.children[0].url !== url) return unsupported();
      const rawHash = raw.indexOf('#');
      if (hash >= 0 && rawHash < 0) return unsupported();
      if (rawHash >= 0) {
        const fragment = fromMarkdown(`[x](<x${raw.slice(rawHash)}>)`).children[0];
        if (fragment?.type !== 'paragraph' || fragment.children[0]?.type !== 'link' || fragment.children[0].url !== `x${url.slice(hash)}`) return unsupported();
      }
      const encoded = relative.split('/').map(part => encodeURIComponent(part).replaceAll("'", '%27')).join('/');
      replacements.push({ start, end, text: encoded + (rawHash < 0 ? '' : raw.slice(rawHash)) });
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(masked));
  for (const item of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, item.start) + item.text + source.slice(item.end);
  return source;
}
