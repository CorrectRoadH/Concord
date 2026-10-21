// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md
import { posix } from 'node:path';
import type { Nodes } from 'mdast';
import { fromMarkdown } from './markdown-parser.js';
import { markdownBody, inspectSteps, headingAnchors } from './steps.js';
import { parseTestDeclarations } from './annotations.js';
import { codeReferenceTokens } from './code.js';
import { loadDocuments, readDocumentSelector } from './documents.js';
import { decodeDocumentSource } from './document-codec.js';
import { DOCUMENT_NAME_PATTERN } from './document-name.js';
import { ConcordError, canonical, digest, type Change, type Repository } from './shared.js';

interface Replacement { readonly start: number; readonly end: number; readonly text: string }
export interface StepRename { readonly useCase: string; readonly oldId: string; readonly newId: string }
const incomplete = (path: string): never => { throw new ConcordError('ReferenceScanIncomplete', `Cannot reliably locate or scan reference tokens in ${path}`); };
const within = (path: string, roots: readonly string[]) => roots.some(root => path === root || path.startsWith(`${root}/`));
function replace(source: string, replacements: readonly Replacement[]): string {
  let after = source, boundary = source.length;
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    if (item.end > boundary || item.start < 0 || item.start > item.end) incomplete('overlapping token ranges');
    after = after.slice(0, item.start) + item.text + after.slice(item.end); boundary = item.start;
  }
  return after;
}

function markdownTarget(path: string, url: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(url); } catch { return undefined; }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(decoded) || decoded.startsWith('/')) return undefined;
  const hash = decoded.indexOf('#');
  if (hash < 0) return undefined;
  const target = decoded.slice(0, hash);
  const file = target === '' ? path : target.startsWith('docs/') ? posix.normalize(target) : posix.normalize(posix.join(posix.dirname(path), target));
  return `${file}${decoded.slice(hash)}`;
}

/** MDAST decides whether a destination is real; source positions only locate its bytes. */
export function markdownReferenceTokens(path: string, source: string): readonly { readonly target: string; readonly start: number; readonly end: number }[] {
  const tokens: { target: string; start: number; end: number }[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'link' || node.type === 'definition' || node.type === 'image') {
      const target = markdownTarget(path, node.url);
      if (target !== undefined) {
        let start: number;
        if (node.type === 'definition') {
          const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
          const prefix = /^\s*\[(?:\\.|[^\]\\])*\]:\s*/u.exec(raw)?.[0];
          if (prefix === undefined) return incomplete(path);
          start = node.position!.start.offset! + prefix.length;
        } else if (node.type === 'image') {
          // Image alt text has no child positions. The closing bracket is located lexically.
          const raw = source.slice(node.position!.start.offset, node.position!.end.offset);
          const prefix = /^!\[(?:\\.|[^\]\\])*\]\(\s*/u.exec(raw)?.[0];
          if (prefix === undefined) return incomplete(path);
          start = node.position!.start.offset! + prefix.length;
        } else {
          start = node.children.at(-1)?.position?.end.offset ?? node.position!.start.offset! + 1;
          const prefix = /^\]\(\s*/u.exec(source.slice(start))?.[0];
          if (prefix === undefined) return incomplete(path);
          start += prefix.length;
        }
        const angled = source[start] === '<';
        if (angled) start++;
        let end = start, depth = 0;
        for (; end < node.position!.end.offset!; end++) {
          const ch = source[end];
          if (ch === '\\') { end++; continue; }
          if (angled ? ch === '>' : /\s/u.test(ch!)) break;
          if (!angled && ch === ')') { if (depth === 0) break; depth--; }
          if (!angled && ch === '(') depth++;
        }
        const raw = source.slice(start, end);
        const parsed = fromMarkdown(`[x](${angled ? `<${raw}>` : raw})`).children[0];
        if (parsed?.type !== 'paragraph' || parsed.children[0]?.type !== 'link' || parsed.children[0].url !== node.url) return incomplete(path);
        tokens.push({ target, start, end });
      }
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(markdownBody(source)));
  return tokens;
}

function sourceTokens(repo: Repository, path: string, source: string): readonly { readonly reference: string; readonly start: number; readonly end: number }[] {
  if (source.includes('\0')) return [];
  const lines = source.split('\n'), tokens: { reference: string; start: number; end: number }[] = [];
  const add = (line: number, reference: string, family: string) => {
    const text = lines[line - 1]!;
    const match = new RegExp(`^[ \\t]*(?://+|#|--|;)[ \\t]*@${family}[ \\t]+(\\S+)[ \\t]*\\r?$`, 'u').exec(text);
    if (match?.[1] !== reference) return incomplete(path);
    const start = lines.slice(0, line - 1).reduce((sum, line) => sum + line.length + 1, 0) + text.indexOf(reference, text.indexOf(`@${family}`) + family.length + 1);
    if (!tokens.some(token => token.start === start)) tokens.push({ reference, start, end: start + reference.length });
  };
  if (within(path, repo.config.testRoots)) {
    // Discovery deliberately ignores oversized test text; maintenance must refuse that gap.
    if (Buffer.byteLength(source) > 1_048_576) return incomplete(path);
    const parsed = parseTestDeclarations(path, source);
    if (parsed.findings.length) return incomplete(path);
    for (const item of parsed.cases) if (item.contractKind === 'use-case') add(item.line, item.contract, 'use-case');
  }
  if (within(path, repo.config.sourceRoots ?? [])) for (const item of codeReferenceTokens(path, source, repo.config.languageServers)) add(item.line, item.reference, 'concord-implements');
  return tokens;
}

export function scanStepReferences(repo: Repository) {
  // Domain inventory owns managed metadata and Memory/Issue reads.
  const documents = loadDocuments(repo);
  const protectedPaths = new Set(documents.filter(doc => doc.metadata.kind === 'memory' || doc.metadata.kind === 'issue').map(doc => doc.path));
  const paths = new Set([...repo.files('docs'), ...repo.config.testRoots.flatMap(root => repo.files(root, 'source')), ...(repo.config.sourceRoots ?? []).flatMap(root => repo.files(root, 'source'))]);
  const files = [...paths].sort().filter(path => !protectedPaths.has(path)).map(path => {
    const source = repo.read(path);
    if (source === undefined) return incomplete(path);
    const markdown = path.startsWith('docs/') && path.endsWith('.md') ? markdownReferenceTokens(path, source) : [];
    const tokens = path.startsWith('docs/') ? [] : sourceTokens(repo, path, source);
    return { path, source, markdown, tokens };
  });
  const inputsDigest = digest(canonical({ files: files.map(file => [file.path, digest(file.source)]), managed: documents.filter(doc => protectedPaths.has(doc.path)).map(doc => [doc.path, doc.digest]).sort() }));
  return { documents, files, inputsDigest };
}

function contains(value: unknown, ref: string): boolean {
  if (typeof value === 'string') return value === ref;
  if (Array.isArray(value)) return value.some(item => contains(item, ref));
  return value !== null && typeof value === 'object' && Object.values(value).some(item => contains(item, ref));
}

export function planStepRename(repo: Repository, request: StepRename) {
  const { useCase, oldId, newId } = request;
  if (!DOCUMENT_NAME_PATTERN.test(oldId) || !DOCUMENT_NAME_PATTERN.test(newId) || oldId === newId) throw new ConcordError('InvalidStepId', 'Step rename requires distinct valid document names');
  const document = readDocumentSelector(repo, useCase, 'use-case');
  if (document.path !== useCase) throw new ConcordError('InvalidReferenceTarget', 'Step publication requires the canonical Use Case path');
  const source = repo.read(useCase)!;
  const extracted = inspectSteps(useCase, source);
  if (extracted.findings.length) throw new ConcordError(extracted.findings[0]!.code, 'Fix invalid or ambiguous steps before renaming', extracted.findings);
  const old = extracted.items.find(item => item.marker?.id === oldId)?.marker;
  if (old === undefined) throw new ConcordError('AnchorNotFound', `Step ${oldId} does not exist in ${useCase}`);
  if (headingAnchors(source).has(newId) || extracted.steps.some(step => step.id === newId)) throw new ConcordError('DuplicateAnchor', `Anchor ${newId} is already occupied`);
  const oldRef = `${useCase}#${oldId}`, newRef = `${useCase}#${newId}`;
  const scan = scanStepReferences(repo);
  for (const record of scan.documents) {
    const kind = record.metadata.kind;
    if ((kind === 'memory' || kind === 'issue' || kind === 'design') && contains(record.metadata, oldRef) || (kind === 'memory' || kind === 'issue') && markdownReferenceTokens(record.path, record.body).some(token => token.target === oldRef)) throw new ConcordError('ManagedReferenceBlocked', `Managed references in ${record.path} require their lifecycle command`);
  }
  const changes: Change[] = [], affectedCases: { before: string; after: string; file: string; named: boolean }[] = [];
  for (const file of scan.files) {
    const replacements: Replacement[] = [];
    if (file.path === useCase) replacements.push({ start: old.start, end: old.end, text: source.slice(old.start, old.end).replace(`{#${oldId}}`, `{#${newId}}`) });
    for (const token of file.tokens) if (token.reference === oldRef) replacements.push({ start: token.start, end: token.end, text: newRef });
    for (const token of file.markdown) if (token.target === oldRef) {
      const raw = file.source.slice(token.start, token.end), hash = raw.indexOf('#');
      // An encoded separator is legal Markdown, but cannot be safely located by this token rule.
      if (hash < 0) return incomplete(file.path);
      replacements.push({ start: token.start + hash + 1, end: token.end, text: newId });
    }
    if (replacements.length) {
      const after = replace(file.source, replacements);
      if (file.path.startsWith('docs/')) {
        const beforeOwner = decodeDocumentSource(file.path, file.source), afterOwner = decodeDocumentSource(file.path, after);
        if (canonical(beforeOwner?.metadata) !== canonical(afterOwner?.metadata)) throw new ConcordError('ManagedReferenceBlocked', `Cannot rewrite metadata in ${file.path}`);
      }
      changes.push({ path: file.path, before: file.source, after });
      if (within(file.path, repo.config.testRoots)) {
        const beforeCases = parseTestDeclarations(file.path, file.source).cases, afterCases = parseTestDeclarations(file.path, after).cases;
        beforeCases.forEach((item, index) => { if (item.contract === oldRef) affectedCases.push({ before: item.id, after: afterCases[index]!.id, file: item.file, named: item.named === true }); });
      }
    }
  }
  return { ...request, changes, affectedCases, inputsDigest: scan.inputsDigest };
}

export function formatStepSource(repo: Repository, path: string, source: string, seed: boolean, list?: number): string {
  const extracted = inspectSteps(path, source);
  if (extracted.findings.length) throw new ConcordError(extracted.findings[0]!.code, 'Fix invalid or ambiguous steps before formatting', extracted.findings);
  if (seed !== (list !== undefined) || list !== undefined && (!Number.isSafeInteger(list) || list < 1 || !extracted.lists.some(item => item.ordinal === list))) throw new ConcordError('InvalidStepList', '--seed and --list must select one existing root ordered list');
  const selected = new Set(extracted.lists.filter(item => item.marked > 0 || item.ordinal === list).map(item => item.ordinal));
  if (!selected.size) return source;
  if (extracted.lists.some(list => selected.has(list.ordinal) && extracted.items.filter(item => item.listOrdinal === list.ordinal).length !== list.items)) throw new ConcordError('InvalidStepPosition', 'Every selected item must start with a paragraph');
  const scan = scanStepReferences(repo), occupied = new Set([...headingAnchors(source), ...extracted.steps.map(step => step.id)]);
  for (const file of scan.files) for (const ref of [...file.tokens.map(token => token.reference), ...file.markdown.map(token => token.target)]) if (ref.startsWith(`${path}#`)) occupied.add(ref.slice(path.length + 1));
  for (const record of scan.documents) {
    const collect = (value: unknown): void => {
      if (typeof value === 'string' && value.startsWith(`${path}#`)) occupied.add(value.slice(path.length + 1));
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(record.metadata);
    if (record.metadata.kind === 'memory' || record.metadata.kind === 'issue') for (const token of markdownReferenceTokens(record.path, record.body)) if (token.target.startsWith(`${path}#`)) occupied.add(token.target.slice(path.length + 1));
  }
  let next = Math.max(0, ...extracted.steps.map(step => /^step-([0-9]+)$/u.exec(step.id)?.[1]).filter(value => value !== undefined).map(Number)) + 1;
  if (!Number.isSafeInteger(next)) throw new ConcordError('InvalidStepId', 'Step sequence exceeds the safe integer range');
  const replacements: Replacement[] = [];
  for (const item of extracted.items.filter(item => selected.has(item.listOrdinal))) {
    if (item.marker !== undefined) replacements.push({ start: item.marker.start, end: item.marker.end, text: ` {#${item.marker.id}}` });
    else {
      while (occupied.has(`step-${next}`)) {
        next++;
        if (!Number.isSafeInteger(next)) throw new ConcordError('InvalidStepId', 'Step sequence exceeds the safe integer range');
      }
      if (!Number.isSafeInteger(next)) throw new ConcordError('InvalidStepId', 'Step sequence exceeds the safe integer range');
      const id = `step-${next++}`; occupied.add(id);
      const end = item.paragraph.position!.end.offset!;
      const trailing = /[ \t]+$/u.exec(source.slice(item.paragraph.position!.start.offset, end))?.[0].length ?? 0;
      replacements.push({ start: end - trailing, end, text: ` {#${id}}` });
    }
  }
  return replace(source, replacements);
}
