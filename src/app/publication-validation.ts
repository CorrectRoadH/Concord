import { Layer } from "effect";
import { PublicationValidation } from "../base/publication/index.js";
import { readWritingPolicy } from "../domain/writing/index.js";
import { analyzeCatalogs, catalogDependencies, catalogSources, readConceptCatalog, splitReference } from "../domain/concepts/index.js";
import { scopeOf, catalogName, EMPTY_CONCEPT_CATALOG, canonical } from "../model/index.js";
import { planIssueClose } from './issue-close.js';
import { planStepRename } from "./step-rewrite.js";

export const PublicationValidationLive = Layer.succeed(PublicationValidation, PublicationValidation.of({
  validateWriting: (source, path) => { readWritingPolicy(source, path); },
  planStepRename,
  planIssueClose,
  validateCatalog: (repo, journal, fail) => {
    const catalogChanges = journal.changes.filter(change => change.path.endsWith(`/${catalogName}`) && !change.path.split('/').some(part => part === '_template' || part === '.git' || part === 'node_modules'));
    if (journal.operation === 'set-concepts' || journal.operation === 'init' && catalogChanges.length > 0) {
      if (journal.operation === 'init') {
        if (catalogChanges.length !== 1 || catalogChanges[0]?.path !== 'docs/concepts.md' || catalogChanges[0].before !== null || catalogChanges[0].after !== EMPTY_CONCEPT_CATALOG) fail('Init may only create the exact empty global catalog');
      } else {
        const change = journal.changes[0];
        if (journal.scope.kind !== 'documents' || journal.operation !== 'set-concepts' || journal.changes.length !== 1 || change?.after == null || journal.catalogDependencies === undefined) fail('Concept journal has an unauthorized operation, path, deletion, or missing guard');
        try { scopeOf(change!.path, 'catalog'); readConceptCatalog(change!.after!); } catch { fail('Concept journal has an invalid after image'); }
        const expected = catalogDependencies(repo, change!.path);
        if (canonical(expected) !== canonical(journal.catalogDependencies)) fail('Catalog dependency membership or content changed');
        const sources = catalogSources(repo);
        if (change!.before === null) sources.delete(change!.path);
        else sources.set(change!.path, change!.before);
        const old = analyzeCatalogs(sources);
        sources.set(change!.path, change!.after!);
        const next = analyzeCatalogs(sources);
        if (next.diagnostics.some(item => item.sources[0] === change!.path)) fail('Concept imports do not resolve');
        const oldIds = new Set(old.byPath.get(change!.path)?.catalog.concepts.map(item => item.id) ?? []);
        const newIds = new Set(readConceptCatalog(change!.after!).concepts.map(item => item.id));
        if ([...oldIds].some(id => !newIds.has(id)) && old.diagnostics.some(item => item.code === 'InvalidConceptCatalog' && item.sources[0] !== change!.path)) fail('Cannot remove definitions while another catalog is malformed');
        for (const record of old.catalogs.filter(item => item.path !== change!.path)) for (const reference of record.catalog.imports ?? []) {
          if (reference.startsWith(`${change!.path}#`) && !newIds.has(splitReference(reference).id)) fail(`Imported concept removed: ${reference}`);
        }
      }
    }
  },
}));
