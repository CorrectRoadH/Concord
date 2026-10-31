// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { parseDocument } from './markdown-dependencies.js';
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
  if (/^docs\/(?:feature|engineering)\/[^/]+\/use-case\/(?!README\.md$)[^/]+\.md$/u.test(path)) return 'use-case';
  const match = /^docs\/(feature|engineering|roadmap)\/[^/]+\/README\.md$/u.exec(path);
  if (match !== null) return match[1] as DocumentKind;
  if (/^docs\/design\/(?!README\.md$)[^/]+\.md$/u.test(path)) return 'design';
  return undefined;
}

/** Current files only. Derivable metadata cannot authorize an old format. */
export function decodeUncachedDocumentSource(path: string, source: string, tree?: Root): DocumentRecord | undefined {
  const kind = ownerKind(path);
  const specPage = /^docs\/(?:feature|engineering|roadmap|design)\//u.test(path) && path.endsWith('.md');
  if (specPage && /^(?:\uFEFF)?---\r?\n/u.test(source)) throw new ConcordError('InvalidData', `${path}: this document must not have frontmatter`);
  if (kind === undefined) return undefined;
  let body = source;
  let fields: object = {};
  if (kind === 'memory' || kind === 'issue') {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
    if (match === null && /^---(?:\r?\n|$)/u.test(source)) throw new ConcordError('InvalidData', `${path}: expected closed ${kind} frontmatter`);
    if (match !== null) {
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
    } else fields = { relations: [] };
  }
  const id = kind === 'use-case' || kind === 'issue' || kind === 'memory' || kind === 'design' ? path.split('/').at(-1)!.slice(0, -3) : path.split('/').at(-2)!;
  if (kind === 'use-case') fields = { feature: `${path.split('/').slice(0, 3).join('/')}/README.md` };
  if (kind === 'roadmap') fields = { state: 'planned' };
  const metadata = decode(DocumentSchema, { format: 'concord.document/v1', id, title: documentTitle(path, body, tree), kind, ...fields }, path);
  return { path, metadata, body, digest: digest(source) };
}
