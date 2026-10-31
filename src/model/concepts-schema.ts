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
    const deprecated: string[] = [];
    let oldNames = false;
    for (const following of nodes.slice(index + 2)) {
      if (following.type === 'heading' && following.depth <= 2) break;
      if (following.type !== 'paragraph' || !plain(following).startsWith('旧写法：')) continue;
      if (oldNames) invalid(following.position!.start.line, 'One deprecated-spelling paragraph is allowed per concept');
      oldNames = true;
      const children = following.children;
      if (children[0]?.type !== 'text' || children[0].value.trim() !== '旧写法：') invalid(following.position!.start.line, 'Deprecated spellings must use inline code');
      for (const child of children.slice(1)) {
        if (child.type === 'inlineCode' && child.value.trim().length > 0) deprecated.push(child.value);
        else if (child.type !== 'text' || !/^[\s、,，。]*$/u.test(child.value)) invalid(child.position?.start.line ?? following.position!.start.line, 'Separate inline-code spellings with commas or 、');
      }
      if (!deprecated.length) invalid(following.position!.start.line, 'Deprecated-spelling paragraph requires a spelling');
    }
    concepts.push({ id: id!, term: term!, definition: source.slice(definition!.position!.start.offset, definition!.position!.end.offset), deprecated });
    onConcept?.(id!, line);
  }
  const oldNames = new Set<string>();
  for (const concept of concepts) for (const name of concept.deprecated) {
    const key = conceptSpellingKey(name);
    if (name.trim() !== name || terms.has(key) || oldNames.has(key)) invalid(1, `Duplicate, padded or active deprecated name: ${name}`);
    oldNames.add(key);
  }
  return { title: plain(title), concepts };
}
