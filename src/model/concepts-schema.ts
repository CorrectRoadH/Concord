// @concord-file
// @concord-implements docs/feature/documentation-quality/format.md#conceptsmd
import { Schema } from "effect";
import type { Nodes, Root } from "mdast";

const Nonblank = Schema.String.check(Schema.isPattern(/\S/u));
const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
export const ConceptDefinitionSchema = Schema.Struct({ id: Slug, term: Nonblank, definition: Nonblank, deprecated: Schema.Array(Nonblank) });
export const ConceptCatalogSchema = Schema.Struct({
  title: Nonblank, concepts: Schema.Array(ConceptDefinitionSchema),
});
export type ConceptDefinition = typeof ConceptDefinitionSchema.Type;
export type ConceptCatalog = typeof ConceptCatalogSchema.Type;
export const EMPTY_CONCEPT_CATALOG = '# Project concepts\n\nEach second-level heading defines one concept: its text is the only accepted spelling, `{#id}` is its stable identity, and the first paragraph is its definition.\n';
export const conceptSpellingKey = (value: string): string => /^[\x20-\x7e]+$/u.test(value) ? value.toLowerCase() : value;

/** Pure parser shared by the CLI's lazy mdast parser and the browser's parser. */
export function parseConceptCatalog(source: string, parse: (source: string) => Root, onConcept?: (id: string, line: number) => void): ConceptCatalog {
  const invalid = (line: number, reason: string): never => { throw new Error(`line ${line}: ${reason}`); };
  if (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source)) invalid(1, 'Concept catalogs must not have frontmatter');
  const nodes = parse(source).children;
  const headings = nodes.filter(node => node.type === 'heading');
  const titles = headings.filter(node => node.depth === 1);
  if (titles.length !== 1) invalid(titles[1]?.position?.start.line ?? 1, 'Catalog requires exactly one H1 before all concepts');
  const title = titles[0]!;
  const firstConcept = headings.find(node => node.depth === 2);
  if (firstConcept && title.position!.start.offset! > firstConcept.position!.start.offset!) invalid(firstConcept.position!.start.line, 'H1 must precede all concepts');
  const plain = (node: Nodes): string => node.type === 'text' || node.type === 'inlineCode' ? node.value : 'children' in node ? node.children.map(plain).join('') : node.type === 'image' ? node.alt ?? '' : '';
  const concepts: ConceptDefinition[] = [], ids = new Set<string>(), terms = new Set<string>();
  const deprecatedItems: { concept: ConceptDefinition; item: { term: string; line: number } }[] = [];
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
    const deprecated: { term: string; line: number }[] = [];
    let oldNames = false;
    for (const following of nodes.slice(index + 2)) {
      if (following.type === 'heading' && following.depth <= 2) break;
      if (following.type !== 'paragraph' || !plain(following).startsWith('旧写法：')) continue;
      if (oldNames) invalid(following.position!.start.line, 'One deprecated-spelling paragraph is allowed per concept');
      oldNames = true;
      const children = following.children;
      if (children[0]?.type !== 'text' || children[0].value.trim() !== '旧写法：') invalid(following.position!.start.line, 'Deprecated spellings must use inline code');
      for (const child of children.slice(1)) {
        if (child.type === 'inlineCode' && child.value.trim().length > 0) deprecated.push({ term: child.value, line: child.position?.start.line ?? following.position!.start.line });
        else if (child.type !== 'text' || !/^[\s、,，。]*$/u.test(child.value)) invalid(child.position?.start.line ?? following.position!.start.line, 'Separate inline-code spellings with commas or 、');
      }
      if (!deprecated.length) invalid(following.position!.start.line, 'Deprecated-spelling paragraph requires a spelling');
    }
    const def = { id: id!, term: term!, definition: source.slice(definition!.position!.start.offset, definition!.position!.end.offset), deprecated: deprecated.map(item => item.term) };
    concepts.push(def);
    for (const item of deprecated) deprecatedItems.push({ concept: def, item });
    onConcept?.(id!, line);
  }
  const oldNames = new Map<string, { term: string; line: number }>();
  const catalogErrors: { line: number; message: string }[] = [];
  for (const { concept, item } of deprecatedItems) {
    const name = item.term;
    const line = item.line;
    const key = conceptSpellingKey(name);
    if (name.trim() !== name) {
      catalogErrors.push({ line, message: `Padded deprecated name: ${name}` });
    } else if (key === conceptSpellingKey(concept.term)) {
      catalogErrors.push({ line, message: `Redundant deprecated spelling (matches concept term ${concept.term} case-insensitively): ${name}` });
    } else if (terms.has(key)) {
      catalogErrors.push({ line, message: `Active deprecated name matches existing concept term: ${name}` });
    } else if (oldNames.has(key)) {
      catalogErrors.push({ line, message: `Duplicate deprecated name: ${name}` });
    } else {
      oldNames.set(key, item);
    }
  }
  if (catalogErrors.length > 0) {
    const message = catalogErrors.map(e => `line ${e.line}: ${e.message}`).join('; ');
    throw new Error(message);
  }
  return { title: plain(title), concepts };
}
