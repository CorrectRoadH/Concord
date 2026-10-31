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
  validateCatalog: (_repo, journal, fail) => {
    if (journal.operation !== 'init') return;
    const catalogs = journal.changes.filter(change => change.path.endsWith('/concepts.md') && !change.path.startsWith('docs/_template/'));
    if (catalogs.length > 0 && (catalogs.length !== 1 || catalogs[0]?.path !== 'docs/concepts.md' || catalogs[0].before !== null || catalogs[0].after !== EMPTY_CONCEPT_CATALOG)) fail('Init may only create the exact empty global catalog');
  },
}));
