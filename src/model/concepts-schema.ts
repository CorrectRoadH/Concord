// @concord-file
// @concord-implements docs/feature/documentation-quality/policy.md#概念定义
import { Schema } from "effect";
import { parseDocument } from './markdown-dependencies.js';
import type { Nodes, Root } from "mdast";

const Nonblank = Schema.String.check(Schema.isPattern(/\S/u));
const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
export const ConceptDefinitionSchema = Schema.Struct({ id: Slug, term: Nonblank, definition: Nonblank, deprecated: Schema.Array(Nonblank) });
export const ConceptCatalogSchema = Schema.Struct({
  title: Nonblank, imports: Schema.Array(Nonblank), deprecated: Schema.Record(Slug, Schema.NonEmptyArray(Nonblank)), concepts: Schema.Array(ConceptDefinitionSchema),
});
const FrontmatterSchema = Schema.Struct({ imports: Schema.optional(Schema.Array(Nonblank)), deprecated: Schema.optional(Schema.Record(Slug, Schema.NonEmptyArray(Nonblank))) });
export type ConceptDefinition = typeof ConceptDefinitionSchema.Type;
export type ConceptCatalog = typeof ConceptCatalogSchema.Type;
export const EMPTY_CONCEPT_CATALOG = '# Project concepts\n\nEach second-level heading defines one concept: its text is the only accepted spelling, `{#id}` is its stable identity, and the first paragraph is its definition.\n';
export const conceptSpellingKey = (value: string): string => /^[\x20-\x7e]+$/u.test(value) ? value.toLowerCase() : value;

/** Pure parser shared by the CLI's lazy mdast parser and the browser's parser. */
export function parseConceptCatalog(source: string, parse: (source: string) => Root, onConcept?: (id: string, line: number) => void): ConceptCatalog {
  const invalid = (line: number, reason: string): never => { throw new Error(`line ${line}: ${reason}`); };
  let body = source;
  let metadata: typeof FrontmatterSchema.Type = {};
  const metadataLine = (key: string) => Math.max(2, source.slice(0, source.search(new RegExp(`^${key}:`, 'mu'))).split('\n').length);
  if (/^---(?:\r?\n|$)/u.test(source)) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
    if (!match) invalid(1, 'Unterminated YAML frontmatter');
    try {
      const document = parseDocument(match![1]!, { uniqueKeys: true, merge: false });
      if (document.errors.length) invalid((document.errors[0]!.linePos?.[0].line ?? 1) + 1, document.errors.map(error => error.message).join('; '));
      metadata = Schema.decodeUnknownSync(FrontmatterSchema, { onExcessProperty: 'error', errors: 'all' })(document.toJS({ maxAliasCount: 0 }));
    } catch (cause) { invalid(2, cause instanceof Error ? cause.message : String(cause)); }
    body = match![0].replace(/[^\r\n]/gu, ' ') + source.slice(match![0].length);
  }
  const imports = metadata.imports ?? [], deprecated = metadata.deprecated ?? {};
  const seenImports = new Set<string>();
  for (const reference of imports) {
    const [path, id, extra] = reference.split('#');
    if (!path || !/^docs\/(?:[^/#]+\/)*concepts\.md$/u.test(path) || path.split('/').some(part => ['', '.', '..', '_template', '.git', 'node_modules'].includes(part)) || /[\\\x00-\x1f]/u.test(path) || !id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) || extra !== undefined) invalid(metadataLine('imports'), `Invalid catalog import: ${reference}`);
    if (seenImports.has(reference)) invalid(metadataLine('imports'), `Duplicate import: ${reference}`);
    seenImports.add(reference);
  }
  const nodes = parse(body).children;
  const headings = nodes.filter(node => node.type === 'heading');
  const titles = headings.filter(node => node.depth === 1);
  if (titles.length !== 1) invalid(titles[1]?.position?.start.line ?? 1, 'Catalog requires exactly one H1 before all concepts');
  const title = titles[0]!;
  const firstConcept = headings.find(node => node.depth === 2);
  if (firstConcept && title.position!.start.offset! > firstConcept.position!.start.offset!) invalid(firstConcept.position!.start.line, 'H1 must precede all concepts');
  const plain = (node: Nodes): string => node.type === 'text' || node.type === 'inlineCode' ? node.value : 'children' in node ? node.children.map(plain).join('') : node.type === 'image' ? node.alt ?? '' : '';
  const concepts: ConceptDefinition[] = [], ids = new Set<string>(), terms = new Set<string>();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type !== 'heading' || node.depth !== 2) continue;
    const line = node.position!.start.line;
    if (node.children.some(child => child.type !== 'text')) invalid(line, 'Concept heading must contain only plain text');
    const match = /^(.*) \{#([a-z0-9]+(?:-[a-z0-9]+)*)\}$/u.exec(plain(node));
    if (!match) invalid(line, 'Concept H2 requires term {#id}');
    const [, term, id] = match!;
    if (!term || term.trim() !== term) invalid(line, 'Concept term must be nonempty and unpadded');
    if (ids.has(id!)) invalid(line, `Duplicate concept ID: ${id}`);
    if (terms.has(conceptSpellingKey(term!))) invalid(line, `Duplicate concept term: ${term}`);
    const definition = nodes[index + 1];
    if (definition?.type !== 'paragraph') invalid(definition?.position?.start.line ?? line, `First block after ${id} must be a definition paragraph`);
    ids.add(id!); terms.add(conceptSpellingKey(term!));
    concepts.push({ id: id!, term: term!, definition: source.slice(definition!.position!.start.offset, definition!.position!.end.offset), deprecated: Object.hasOwn(deprecated, id!) ? deprecated[id!]! : [] });
    onConcept?.(id!, line);
  }
  const oldNames = new Set<string>();
  for (const [id, names] of Object.entries(deprecated)) {
    if (!ids.has(id)) invalid(metadataLine('deprecated'), `Deprecated key has no concept: ${id}`);
    for (const name of names) {
      const key = conceptSpellingKey(name);
      if (name.trim() !== name || terms.has(key) || oldNames.has(key)) invalid(metadataLine('deprecated'), `Duplicate, padded or active deprecated name: ${name}`);
      oldNames.add(key);
    }
  }
  return { title: plain(title), imports, deprecated, concepts };
}
