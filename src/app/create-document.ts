import { posix } from "node:path";
import { Effect, Schema } from "effect";
import { renderDocument } from "../model/index.js";
import { ConcordError, failure, DocumentName, decode, inRepositorySnapshot, type DocumentKind, type DocumentMeta, type MutationReceipt, type Repository } from "../model/index.js";
import { templateCatalog } from "../domain/documents/index.js";
import { TEMPLATE_PAGES } from "../model/index.js";
import { defaultDocumentPath, documentPlacementError } from "../model/index.js";
import { now } from "../domain/documents/index.js";
import { required } from "../domain/documents/index.js";
import { authorBody } from "../domain/documents/index.js";
import { loadDocuments } from "../domain/documents/index.js";
import { findDocument } from "../domain/documents/index.js";


export interface CreateDocumentInput {
  readonly id: string;
  readonly title: string;
  readonly body?: string;
  readonly feature?: string;
  readonly pages?: readonly string[];
  readonly dryRun?: boolean;
}


// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#roadmap
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#add
export const createDocument = Effect.fn('createDocument')(function*(repo: Repository, kind: DocumentKind, input: CreateDocumentInput) {
  const catalog = yield* templateCatalog();
  return yield* Effect.try({ try: (): MutationReceipt => inRepositorySnapshot(repo, () => {
  const id = decode(DocumentName, input.id, 'id');
  if (['use-case', 'issue', 'memory', 'design'].includes(kind) && id.toLowerCase() === 'readme') throw new ConcordError('InvalidInput', 'README is reserved for navigation');
  const title = required(input.title, 'title');
  if (input.feature !== undefined && kind !== 'use-case') throw new ConcordError('InvalidInput', 'feature is only valid for use-case');
  if (input.pages !== undefined && !['feature', 'roadmap'].includes(kind)) throw new ConcordError('InvalidInput', 'pages is only valid for feature and roadmap');
  const selected = decode(Schema.Array(Schema.Literals(TEMPLATE_PAGES)), input.pages ?? [], 'pages');
  if (new Set(selected).size !== selected.length) throw new ConcordError('InvalidInput', 'pages must be unique');
  const requested = TEMPLATE_PAGES.filter(page => selected.includes(page));
  const bodyFor = (name: string) => authorBody(input.body ?? catalog.render(name, title, requested));
  const createdAt = now();
  const documents = kind === 'memory' ? [] : loadDocuments(repo, kind === 'issue' ? ['issue'] : undefined);
  if (kind !== 'memory' && kind !== 'use-case' && documents.some(document => document.metadata.kind === kind && document.metadata.id === id)) {
    throw new ConcordError('DocumentExists', `${kind} id ${id} already exists; use its canonical path`);
  }
  let path: string;
  let metadata: DocumentMeta;
  let template: string = kind;
  switch (kind) {
    case 'feature': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'use-case': {
      const feature = findDocument(documents, required(input.feature, 'feature'), 'feature');
      const placement = documentPlacementError('feature', feature.path);
      if (placement !== undefined) throw new ConcordError('InvalidPlacement', placement);
      path = defaultDocumentPath(kind, id, feature.path);
      metadata = { format: 'concord.document/v1', id, title, kind, feature: feature.path };
      break;
    }
    case 'roadmap': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, state: 'planned' }; break;
    case 'design': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'engineering': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'memory': path = `memory/${id}.md`; metadata = { format: 'concord.document/v1', id, title, kind, relations: [] }; break;
    case 'issue': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind, relations: [] }; break;
  }
  const body = bodyFor(template);
  const changes = [{ path, before: null, after: renderDocument(metadata, body) }];
  const allowed = kind === 'feature' || kind === 'roadmap';
  const add = (pagePath: string, name: string) => changes.push({ path: pagePath, before: null, after: authorBody(catalog.render(name, title, requested)) });
  if (allowed) for (const page of requested) add(`${posix.dirname(path)}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
  for (const change of changes) if (repo.read(change.path) !== undefined) throw new ConcordError('DocumentExists', `${change.path} already exists`);
  return repo.publish(`create-${kind}`, changes, input.dryRun ?? false);
  }), catch: failure });
});
// @concord-end
