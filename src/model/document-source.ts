// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { parseDocument } from "yaml";
import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "./markdown-parser.js";
import { IssueFrontmatterSchema, MemoryFrontmatterSchema } from "./owner-frontmatter.js";
import { ConcordError, DocumentSchema, decode, digest, type DocumentKind, type DocumentRecord } from "./shared.js";

function text(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  return 'children' in node ? node.children.map(text).join('') : '';
}

export function documentTitle(path: string, body: string, tree: Root = fromMarkdown(body)): string {
  const headings: Nodes[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'heading' && node.depth === 1) headings.push(node);
    if ('children' in node) node.children.forEach(visit);
  };
  visit(tree);
  const title = headings.length === 1 ? text(headings[0]!).replace(/\s+\{#[^{}\s]+\}$/u, '') : '';
  if (!title.trim() || title.length > 1024 || /[\r\n\u2028\u2029]/u.test(title)) throw new ConcordError('InvalidData', `${path}: expected exactly one single-line level-one heading (at most 1024 characters)`);
  return title;
}

export function ownerKind(path: string): DocumentKind | undefined {
  if (/^memory\/(?!README\.md$)[^/]+\.md$/u.test(path)) return 'memory';
  if (/^docs\/issues\/(?!README\.md$)[^/]+\.md$/u.test(path)) return 'issue';
  if (/^docs\/feature\/[^/]+\/use-case\/(?!README\.md$)[^/]+\.md$/u.test(path)) return 'use-case';
  const match = /^docs\/(feature|engineering|roadmap|design)\/[^/]+\/README\.md$/u.exec(path);
  if (match !== null) return match[1] as DocumentKind;
  if (/^docs\/research\/(?:[^/]+\/)+README\.md$/u.test(path)) return 'research';
  return undefined;
}

/** Read the template's Sources section through the Markdown tree. */
export function researchSources(body: string, tree: Root = fromMarkdown(body)): { observedAt?: string; sources: string[] } {
  const nodes = tree.children;
  const sections = nodes.flatMap((node, index) => node.type === 'heading' && node.depth === 2 && ['Sources', '来源'].includes(text(node)) ? [index] : []);
  if (sections.length > 1) throw new ConcordError('InvalidData', 'Research has more than one Sources section');
  if (sections.length === 0) return { sources: [] };
  const selected: Nodes[] = [];
  for (const node of nodes.slice(sections[0]! + 1)) {
    if (node.type === 'heading' && node.depth <= 2) break;
    selected.push(node);
  }
  let observedAt: string | undefined;
  const sources: string[] = [];
  const visit = (node: Nodes): void => {
    if (node.type === 'paragraph') {
      const value = text(node);
      const observed = /^(?:Observed at|观察日期|观察时间):\s*(.+)$/u.exec(value);
      const source = /^(?:Source|来源):\s*(.+)$/u.exec(value);
      if (observed !== null) {
        if (observedAt !== undefined) throw new ConcordError('InvalidData', 'Research has duplicate observed dates');
        observedAt = observed[1]!;
      }
      if (source !== null) {
        const link = node.children.find(child => child.type === 'link');
        sources.push(link?.type === 'link' ? link.url : source[1]!);
      }
    }
    if ('children' in node && node.type !== 'paragraph') node.children.forEach(visit);
  };
  selected.forEach(visit);
  return { ...(observedAt === undefined ? {} : { observedAt }), sources };
}

export function renderResearchSources(observedAt: string | undefined, sources: readonly string[]): string {
  if (observedAt === undefined && sources.length === 0) return '';
  return `\n## Sources\n\n${observedAt === undefined ? '' : `- Observed at: ${observedAt}\n`}${sources.map(source => `- Source: ${source}\n`).join('')}`;
}

/** Current files only. Derivable metadata cannot authorize an old format. */
export function decodeUncachedDocumentSource(path: string, source: string, tree?: Root): DocumentRecord | undefined {
  const kind = ownerKind(path);
  const specPage = /^docs\/(?:feature|engineering|roadmap|design|research)\//u.test(path) && path.endsWith('.md');
  if (specPage && /^(?:\uFEFF)?---\r?\n/u.test(source)) throw new ConcordError('InvalidData', `${path}: this document must not have frontmatter`);
  if (kind === undefined) return undefined;
  let body = source;
  let fields: object = {};
  if (kind === 'memory' || kind === 'issue') {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
    if (match === null) throw new ConcordError('InvalidData', `${path}: expected closed ${kind} frontmatter`);
    const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
    if (yaml.errors.length > 0) throw new ConcordError('InvalidData', `${path}: ${yaml.errors.map(error => error.message).join('; ')}`);
    let value: unknown;
    try { value = yaml.toJS({ maxAliasCount: 0 }); }
    catch (cause) { throw new ConcordError('InvalidData', `${path}: ${String(cause)}`); }
    body = match[2]!.replace(/^\r?\n/u, '');
    if (kind === 'memory') {
      const metadata = decode(MemoryFrontmatterSchema, value, path);
      fields = { ...metadata, relations: metadata.relations ?? [] };
    } else {
      const metadata = decode(IssueFrontmatterSchema, value, path);
      fields = { ...metadata, relations: metadata.relations ?? [] };
    }
  }
  const id = kind === 'use-case' || kind === 'issue' || kind === 'memory' ? path.split('/').at(-1)!.slice(0, -3) : path.split('/').at(-2)!;
  if (kind === 'use-case') fields = { feature: `${path.split('/').slice(0, 3).join('/')}/README.md` };
  if (kind === 'design') fields = { alternatives: [] };
  if (kind === 'roadmap') fields = { state: 'planned' };
  if (kind === 'research') fields = researchSources(body, tree);
  const metadata = decode(DocumentSchema, { format: 'concord.document/v1', id, title: documentTitle(path, body, tree), kind, ...fields }, path);
  return { path, metadata, body, digest: digest(source) };
}
