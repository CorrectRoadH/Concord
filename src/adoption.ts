// @concord-file adopted-document-links
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
import { posix } from 'node:path';
import { ConcordError } from './shared.js';

/** A deliberately bounded Markdown link transform, never a best-effort rewrite. */
export function rebaseAdoptedMarkdown(source: string, sourcePath: string, destinationPath: string, sourceDirectory: string): string {
  const destinationDirectory = destinationPath.slice(0, -posix.relative(sourceDirectory, sourcePath).length - 1);
  const unsupported = (detail: string): never => { throw new ConcordError('UnsupportedMarkdownLink', `${sourcePath}: ${detail}; adoption supports simple inline links and single-line reference definitions`); };
  const rewrite = (raw: string): string => {
    if (raw.startsWith('#') || raw.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw)) return raw;
    // Encoded/escaped paths and queries need a richer URL and Markdown grammar.
    if (!raw || /[\\%&?<>\s()]/u.test(raw)) return unsupported(`unsupported destination ${raw}`);
    const hash = raw.indexOf('#');
    const pathname = hash < 0 ? raw : raw.slice(0, hash);
    const anchor = hash < 0 ? '' : raw.slice(hash);
    const target = posix.normalize(posix.join(posix.dirname(sourcePath), pathname));
    if (target.startsWith('../')) return unsupported(`destination escapes the repository: ${raw}`);
    const mapped = target === sourceDirectory || target.startsWith(`${sourceDirectory}/`) ? `${destinationDirectory}${target.slice(sourceDirectory.length)}` : target;
    const rebased = posix.relative(posix.dirname(destinationPath), mapped);
    return `${rebased || '.'}${anchor}`;
  };
  const prose = (text: string): string => {
    if (/<\/?[A-Za-z!]/u.test(text)) return unsupported('HTML and angle destinations require explicit migration');
    if (/\\[\[\]()]/u.test(text)) return unsupported('escaped link syntax requires explicit migration');
    const definition = /^([ ]{0,3}\[[^\]\n]+\]:[ \t]*)(.*)$/u.exec(text);
    if (definition) {
      if (/^ *\[\^/u.test(text)) return unsupported('footnote definitions require explicit migration');
      const destination = /^([^\s()<>]+)([ \t]*)$/u.exec(definition[2]!);
      if (!destination) return unsupported('complex or multiline reference definition');
      return `${definition[1]}${rewrite(destination[1]!)}${destination[2]}`;
    }
    if (/\[[^\]\n]+\]:/u.test(text)) return unsupported('nested reference definitions require explicit migration');
    // Titles, empty destinations and nested parentheses are outside this subset.
    let cursor = 0;
    let output = '';
    let matches = 0;
    const link = /!?\[[^\]\n]*\]\(/gu;
    for (let match = link.exec(text); match; match = link.exec(text)) {
      matches += 1;
      output += text.slice(cursor, match.index);
      const rest = text.slice(link.lastIndex);
      const destination = /^([^\s()<>]+)\)/u.exec(rest);
      if (!destination) return unsupported('complex or multiline inline destination');
      output += `${match[0]}${rewrite(destination[1]!)})`;
      cursor = link.lastIndex + destination[0].length;
      link.lastIndex = cursor;
    }
    if (matches !== (text.match(/\]\(/gu)?.length ?? 0)) return unsupported('nested or incomplete link label');
    output += text.slice(cursor);
    // A newline between the label and destination is also CommonMark syntax.
    if (/^\s*\(/u.test(output)) return unsupported('potential multiline link');
    return output;
  };

  let fence: { marker: string; length: number } | undefined;
  let codeTicks: number | undefined;
  let blank = true;
  let indentedCode = false;
  let container = false;
  const result = source.split(/(\r?\n)/u).map(line => {
    if (/^\r?\n$/u.test(line)) return line;
    if (line.trim() === '') { blank = true; return line; }
    if (!codeTicks) {
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence) {
        if (delimiter && delimiter[1]![0] === fence.marker && delimiter[1]!.length >= fence.length && delimiter[2]!.trim() === '') fence = undefined;
        return line;
      }
      if (delimiter) { fence = { marker: delimiter[1]![0]!, length: delimiter[1]!.length }; return line; }
      if (/^(?: {4}|\t)/u.test(line)) {
        if (container) return unsupported('indented container content requires explicit migration');
        if (blank || indentedCode) { indentedCode = true; blank = false; return line; }
      } else {
        indentedCode = false;
        container = /^ {0,3}(?:>|[-+*]|\d+[.)])\s/u.test(line);
      }
      if (/^.*(?:>|[-+*]|\d+[.)])\s+(?:`{3,}|~{3,})/u.test(line)) return unsupported('nested fenced code blocks require explicit migration');
    }
    blank = false;
    // Transform only prose spans, including real links next to inline code.
    const runs = /`+/gu;
    let cursor = 0;
    let output = '';
    for (let match = runs.exec(line); match; match = runs.exec(line)) {
      if (!codeTicks && line[match.index - 1] === '\\') return unsupported('escaped code delimiter requires explicit migration');
      const part = line.slice(cursor, match.index);
      output += codeTicks ? part : prose(part);
      output += match[0];
      if (!codeTicks) codeTicks = match[0].length;
      else if (codeTicks === match[0].length) codeTicks = undefined;
      cursor = runs.lastIndex;
    }
    output += codeTicks ? line.slice(cursor) : prose(line.slice(cursor));
    return output;
  }).join('');
  if (codeTicks) return unsupported('unmatched inline code delimiter');
  return result;
}
