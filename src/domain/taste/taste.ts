import { posix } from "node:path";
import type { Heading, Nodes, Paragraph, PhrasingContent } from "mdast";
import { Predicate } from "effect";
import { ConcordError, digest, type Finding, type Repository } from "../../model/index.js";

import { fromMarkdown } from "../../model/index.js";
import { mdxProse } from "../../base/process/index.js";
import { markdown_facts_markdownAnchor as markdownAnchor } from "../../model/index.js";
import { markdownBody } from "../../model/index.js";
import { documentMarkdown, documentMarkdownProjection } from "../documents/index.js";
import { inspectDocumentRecords } from "../documents/index.js";




export const TASTE_PATH = 'docs/taste.md';
export interface TasteEntry { readonly id: string; readonly title: string; readonly paragraphs: readonly string[] }
export interface TasteRecord { readonly path: typeof TASTE_PATH; readonly source: string; readonly body: string; readonly digest: string; readonly entries: readonly TasteEntry[] }
/** One inline link occurrence; `paragraph` is null when the link targets a entry or the general section. */
export interface TasteReference { readonly path: string; readonly line: number; readonly entry: string }

const ENTRY_ID = /^t-[1-9]\d*$/u;
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

// @concord-begin
// @concord-implements docs/feature/taste/use-case/write-taste.md
function plain(nodes: readonly PhrasingContent[]): string {
  return nodes.map(node => node.type === 'text' || node.type === 'inlineCode' ? node.value : 'children' in node ? plain(node.children) : '').join('');
}

/** A trailing ` {#id}` in the last text node; code, HTML and comments never produce one. */
export function trailingId(source: string, node: Heading | Paragraph): { readonly id: string; readonly start: number } | undefined {
  const last = node.children.at(-1);
  if (last?.type !== 'text' || last.position?.start.offset === undefined || last.position.end.offset === undefined) return undefined;
  const raw = source.slice(last.position.start.offset, last.position.end.offset);
  const match = /[ \t]+\{#([^{}\s]+)\}$/u.exec(raw);
  return match === null ? undefined : { id: match[1]!, start: last.position.end.offset - match[0].length };
}

const invalid = (line: number | undefined, message: string): never => { throw new ConcordError('TasteEntryInvalid', `docs/taste.md:${line ?? 1}: ${message}`, { path: TASTE_PATH, line }); };

/** Clauses are H2 headings with `{#t-N}`; paragraphs are root ordered items below them with `{#general-name}`. */
export function tasteEntries(source: string): TasteEntry[] {
  const masked = markdownBody(source);
  const entries: { id: string; title: string; paragraphs: string[] }[] = [];
  const declared = new Map<string, number>(), slugs = new Set<string>();
  const declare = (id: string, line: number | undefined) => {
    if (declared.has(id)) invalid(line, `duplicate ID ${id}`);
    declared.set(id, line ?? 1);
  };
  let current: { id: string; title: string; paragraphs: string[] } | undefined;
  for (const node of documentMarkdown(TASTE_PATH, source).children) {
    const line = node.position?.start.line;
    if (node.type === 'heading') {
      if (node.depth <= 2) current = undefined;
      const marker = trailingId(masked, node);
      const text = plain(node.children).replace(/\s+\{#[^{}\s]+\}\s*$/u, '').trim();
      if (marker === undefined) {
        const raw = masked.slice(node.position!.start.offset, node.position!.end.offset);
        const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(raw)?.[1];
        const slug = heading === undefined ? undefined : markdownAnchor(`## ${heading}`);
        if (slug !== undefined) { slugs.add(slug); slugs.add(slug.replace(/-+/gu, '-').replace(/^-+|-+$/gu, '')); }
      } else declare(marker.id, line);
      if (node.depth !== 2) continue;
      const label = /^T-(\d+)(?=\s|$)/u.exec(text);
      if (marker?.id === 'general') { current = { id: 'general', title: text, paragraphs: [] }; entries.push(current); continue; }
      if (label === null && (marker === undefined || !/^t-\d+$/u.test(marker.id))) continue;
      if (marker === undefined) invalid(line, `entry heading "${text}" requires a trailing {#t-N}`);
      if (!ENTRY_ID.test(marker!.id)) invalid(line, `entry ID ${marker!.id} must be t- followed by a positive integer without leading zeros`);
      if (label === null || `t-${label[1]}` !== marker!.id) invalid(line, `entry label must be ${marker!.id.toUpperCase()} to match {#${marker!.id}}`);
      const title = text.slice(label![0].length).trim();
      if (title.length === 0) invalid(line, `entry ${marker!.id} requires a title`);
      current = { id: marker!.id, title, paragraphs: [] };
      entries.push(current);
    } else if (node.type === 'list' && node.ordered === true && current?.id === 'general') {
      for (const item of node.children) {
        const first = item.children[0];
        const marker = first?.type === 'paragraph' ? trailingId(masked, first) : undefined;
        const itemLine = item.position?.start.line;
        if (marker === undefined) invalid(itemLine, `paragraph of ${current.id} requires a trailing {#${current.id}-<name>} on its first paragraph`);
        const prefix = `${current.id}-`;
        if (!marker!.id.startsWith(prefix) || !SEGMENT.test(marker!.id.slice(prefix.length))) invalid(itemLine, `paragraph ID ${marker!.id} must be ${prefix} followed by lowercase letters, digits and single hyphens`);
        declare(marker!.id, itemLine);
        current.paragraphs.push(marker!.id);
      }
    }
  }
  for (const [id, line] of declared) if (slugs.has(id)) invalid(line, `ID ${id} collides with a heading slug`);
  return entries;
}

export function entryIndex(entries: readonly TasteEntry[]): ReadonlyMap<string, { readonly entry: string }> {
  const index = new Map<string, { entry: string }>();
  for (const entry of entries) {
    index.set(entry.id, { entry: entry.id });
    for (const paragraph of entry.paragraphs) index.set(paragraph, { entry: paragraph });
  }
  return index;
}

export function parseTaste(source: string): TasteRecord {
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source)) throw new ConcordError('TasteEntryInvalid', 'docs/taste.md:1: frontmatter is not allowed', { path: TASTE_PATH, line: 1 });
  return { path: TASTE_PATH, source, body: source, digest: digest(source), entries: tasteEntries(source) };
}
// @concord-end

type LinkTarget = { readonly kind: 'invalid'; readonly message: string } | { readonly kind: 'whole' } | { readonly kind: 'fragment'; readonly id: string };
type RelativeLink = { readonly kind: 'relative'; readonly path: string; readonly fragment?: string; readonly query: boolean } | { readonly kind: 'invalid'; readonly message: string };

// @concord-begin
// @concord-implements docs/feature/taste/use-case/cite-taste.md
/** Only scheme-less, non-absolute URLs that normalize to the taste are taste links. */
export function relativeMarkdownLink(from: string, url: string): RelativeLink | undefined {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url) || url.startsWith('/')) return undefined;
  const hash = url.indexOf('#');
  const location = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? undefined : url.slice(hash + 1);
  const query = location.indexOf('?');
  const rawPath = query < 0 ? location : location.slice(0, query);
  let decoded: string;
  try { decoded = decodeURIComponent(rawPath); }
  catch { return { kind: 'invalid', message: `Link path ${rawPath} has invalid percent-encoding` }; }
  const target = decoded === '' ? from : posix.normalize(posix.join(posix.dirname(from), decoded));
  return { kind: 'relative', path: target, fragment, query: query >= 0 };
}

export function relativeMarkdownLinkTarget(from: string, url: string, owner: string): LinkTarget | undefined {
  const target = relativeMarkdownLink(from, url);
  if (target === undefined || target.kind === 'invalid') return target;
  if (target.path !== owner) return undefined;
  if (target.query) return { kind: 'invalid', message: `${owner} links must not contain a query` };
  if (target.fragment === undefined || target.fragment === '') return { kind: 'whole' };
  try { return { kind: 'fragment', id: decodeURIComponent(target.fragment) }; }
  catch { return { kind: 'invalid', message: `Link fragment ${target.fragment} has invalid percent-encoding` }; }
}

export function tasteLinkTarget(from: string, url: string): LinkTarget | undefined {
  return relativeMarkdownLinkTarget(from, url, TASTE_PATH);
}

/** Inline link nodes only: images, reference links, HTML and code never contribute. */
export function inlineLinks(source: string, path?: string): { readonly url: string; readonly line: number }[] {
  if (path !== undefined) return [...documentMarkdownProjection(path, source).links];
  return markdownLinks(source);
}

/** Reference occurrences use the occurrence's line, rather than the definition's. */
export function markdownLinks(source: string, options: { readonly references?: boolean; readonly mdx?: boolean } = {}): { readonly url: string; readonly line: number }[] {
  const links: { url: string; line: number }[] = [];
  const body = markdownBody(source);
  const tree = fromMarkdown(options.mdx ? mdxProse(body) : body);
  const definitions = new Map<string, string>();
  const index = (node: Nodes): void => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(index);
  };
  if (options.references) index(tree);
  const visit = (node: Nodes): void => {
    if (node.type === 'link') links.push({ url: node.url, line: node.position?.start.line ?? 1 });
    if (options.references && node.type === 'linkReference') {
      const url = definitions.get(node.identifier);
      if (url !== undefined) links.push({ url, line: node.position?.start.line ?? 1 });
    }
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree);
  return links;
}

export interface TasteLinkScan {
  readonly references: readonly (TasteReference & { readonly target: string })[];
  readonly broken: readonly { readonly path: string; readonly line: number; readonly id: string }[];
  readonly findings: readonly Finding[];
  readonly complete: boolean;
}

const inScope = (path: string) => path.endsWith('.md') && path !== TASTE_PATH && !path.startsWith('docs/_template/');

/** Every inline link from authored docs Markdown is a reference occurrence; reverse views derive from this scan. */
export function scanTasteLinks(repo: Repository, index: ReadonlyMap<string, { readonly entry: string }>, read: (path: string) => string | undefined = path => repo.read(path)): TasteLinkScan {
  const references: (TasteReference & { target: string })[] = [], broken: { path: string; line: number; id: string }[] = [], findings: Finding[] = [];
  let complete = true;
  const candidates: { path: string; source?: string; finding?: Finding }[] = [];
  for (const path of repo.files('docs').filter(inScope).sort()) {
    let source: string | undefined;
    try { source = read(path); }
    catch (cause) { candidates.push({ path, finding: { code: cause instanceof ConcordError ? cause.code : 'SourceChanged', path, message: cause instanceof Error ? cause.message : String(cause) } }); continue; }
    if (source === undefined) { candidates.push({ path, finding: { code: 'SourceChanged', path, message: 'File disappeared while taste references were read' } }); continue; }
    // Any taste link spells the path, percent-encodes it, or uses a character reference.
    if (!/taste|[%&]/iu.test(source)) continue;
    candidates.push({ path, source });
  }
  inspectDocumentRecords(candidates.flatMap(item => item.source === undefined ? [] : [{ path: item.path, source: item.source }]), true);
  for (const { path, source, finding } of candidates) {
    if (finding !== undefined) { complete = false; findings.push(finding); continue; }
    if (source === undefined) continue;
    for (const link of inlineLinks(source, path)) {
      const target = tasteLinkTarget(path, link.url);
      if (target === undefined || target.kind === 'whole') continue;
      if (target.kind === 'invalid') { complete = false; findings.push({ code: 'TasteLinkInvalid', path, line: link.line, message: target.message }); continue; }
      const resolved = index.get(target.id);
      if (resolved === undefined) {
        broken.push({ path, line: link.line, id: target.id });
        findings.push({ code: 'AnchorNotFound', path, line: link.line, message: `Taste entry ${target.id} does not exist` });
        continue;
      }
      references.push({ path, line: link.line, entry: target.id, target: target.id });
    }
  }
  return { references, broken, findings, complete };
}

export interface TasteInspection { readonly record?: TasteRecord; readonly references: TasteLinkScan['references']; readonly findings: readonly Finding[]; readonly complete: boolean }

/** Structure and all in-scope references, without throwing for diagnosable states. */
export function inspectTaste(repo: Repository, read?: (path: string) => string | undefined): TasteInspection {
  if (repo.read(TASTE_PATH) === undefined) return { references: [], findings: [{ code: 'TasteMissing', path: TASTE_PATH, message: 'docs/taste.md is missing' }], complete: true };
  let record: TasteRecord;
  try { record = showTaste(repo); }
  catch (cause) {
    const details = cause instanceof ConcordError && Predicate.isObject(cause.details) && typeof cause.details.line === 'number' ? { line: cause.details.line } : {};
    return { references: [], findings: [{ code: cause instanceof ConcordError ? cause.code : 'TasteEntryInvalid', path: TASTE_PATH, ...details, message: cause instanceof Error ? cause.message : String(cause) }], complete: true };
  }
  const scan = scanTasteLinks(repo, entryIndex(record.entries), read);
  return { record, references: scan.references, findings: scan.findings, complete: scan.complete };
}
// @concord-end

// @concord-code
// @concord-implements docs/feature/taste/use-case/write-taste.md
export function showTaste(repo: Repository): TasteRecord {
  const source = repo.read(TASTE_PATH);
  if (source === undefined) throw new ConcordError('TasteMissing', 'docs/taste.md is missing; create docs/taste.md');
  return parseTaste(source);
}

// @concord-code
// @concord-implements docs/feature/taste/use-case/cite-taste.md
export function tasteShow(repo: Repository) {
  const taste = showTaste(repo);
  const scan = scanTasteLinks(repo, entryIndex(taste.entries));
  const references = scan.references.map(({ path, line, entry }) => ({ path, line, entry }));
  if (scan.findings.some(finding => finding.code === 'TasteLinkInvalid')) throw new ConcordError('TasteLinkInvalid', scan.findings.map(finding => finding.message).join('; '), scan.findings);
  return { operation: 'taste', path: TASTE_PATH, entries: taste.entries.map(({ id, title }) => ({ id, kind: id === 'general' ? 'general' : 'taste', title })), references, complete: scan.complete };
}

// @concord-code
// @concord-implements docs/feature/taste/use-case/remove-cited-entry.md
export function checkTaste(repo: Repository): Finding[] {
  return [...inspectTaste(repo).findings];
}

