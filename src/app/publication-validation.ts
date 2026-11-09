import { Layer } from "effect";
import { PublicationValidation } from "../base/publication/index.ts";
import { readWritingPolicy } from "../domain/writing/index.ts";
import { EMPTY_CONCEPT_CATALOG } from "../model/index.ts";
import { planIssueClose } from './issue-close.ts';
import { planStepRename } from "./step-rewrite.ts";
import { planDocumentMove } from './document-move.ts';

export const PublicationValidationLive = Layer.succeed(PublicationValidation, PublicationValidation.of({
  validateWriting: (source, path) => { readWritingPolicy(source, path); },
  planStepRename,
  planIssueClose,
  planDocumentMove,
  validateCatalog: (_repo, journal, fail) => {
    if (journal.operation !== 'init') return;
    const catalogs = journal.changes.filter(change => change.path.endsWith('/concepts.md') && !change.path.startsWith('docs/_template/'));
    if (catalogs.length > 0 && (catalogs.length !== 1 || catalogs[0]?.path !== 'docs/concepts.md' || catalogs[0].before !== null || catalogs[0].after !== EMPTY_CONCEPT_CATALOG)) fail('Init may only create the exact empty global catalog');
  },
}));
