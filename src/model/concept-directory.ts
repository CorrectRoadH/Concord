import { Schema } from 'effect';
import { ConcordError, type Finding } from './shared.js';
import { parseConceptCatalog, ConceptDefinitionSchema } from './concepts-schema.js';
import { fromMarkdown } from './markdown-parser.js';
import { scopeOf, under } from './writing-scopes.js';

const { definition: _definition, ...descriptor } = ConceptDefinitionSchema.fields;
/** id is the Markdown anchor; term is the current spelling for deprecated names. */
export const WorkspaceConceptSchema = Schema.Struct(descriptor);
export const WorkspaceConceptCatalogSchema = Schema.Struct({
  concepts: Schema.Array(WorkspaceConceptSchema),
  path: Schema.String.check(Schema.makeFilter(value => { try { scopeOf(value, 'catalog'); return true; } catch { return false; } })),
});
export type WorkspaceConcept = typeof WorkspaceConceptSchema.Type;
export type WorkspaceConceptCatalog = typeof WorkspaceConceptCatalogSchema.Type;
export function splitConceptReference(reference: string): { path: string; id: string } {
  const at = reference.lastIndexOf('#');
  if (at < 0) throw new ConcordError('InvalidConceptCatalog', `Expected catalog path#id: ${reference}`);
  const path = reference.slice(0, at), id = reference.slice(at + 1);
  scopeOf(path, 'catalog');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new ConcordError('InvalidConceptCatalog', `Invalid concept reference: ${reference}`);
  return { path, id };
}
/** Shared by the domain's full catalogs and the body-free workspace directory. */
export function selectEffectiveConcepts<Concept extends { readonly id: string }>(file: string, catalogs: readonly {
  readonly path: string; readonly scope: string;
  readonly catalog: { readonly concepts: readonly Concept[] };
}[]): { reference: string; path: string; scope: string; concept: Concept }[] {
  const byPath = new Map(catalogs.map(record => [record.path, record]));
  const effective = new Map<string, { reference: string; path: string; scope: string; concept: Concept }>();
  for (const record of catalogs) {
    if (record.scope !== 'docs' && !under(file, record.scope)) continue;
    for (const concept of record.catalog.concepts) {
      const reference = `${record.path}#${concept.id}`;
      effective.set(reference, { reference, path: record.path, scope: record.scope, concept });
    }

  }
  return [...effective.values()];
}
/** Project only descriptors; definitions and explanations never cross this boundary. */
export function projectConceptCatalogs(pages: readonly { readonly path: string; readonly body: string }[]): { catalogs: WorkspaceConceptCatalog[]; findings: Finding[] } {
  const catalogs: WorkspaceConceptCatalog[] = [], findings: Finding[] = [];
  for (const page of pages) {
    if (!page.path.startsWith('docs/') || !page.path.endsWith('/concepts.md') || page.path.split('/').some(part => ['_template', '.git', 'node_modules'].includes(part))) continue;
    try {
      const catalog = parseConceptCatalog(page.body, fromMarkdown);
      catalogs.push({ path: page.path, concepts: catalog.concepts.map(({ id, term, deprecated }) => ({ id, term, deprecated })) });
    } catch { findings.push({ code: 'InvalidConceptCatalog', path: page.path, message: 'Concept catalog cannot be projected; repair its structure.' }); }
  }
  return { catalogs, findings };
}
