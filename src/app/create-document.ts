import { posix } from "node:path";
import { Schema } from "effect";
import { renderDocument } from "../model/index.js";
import { ConcordError, DocumentName, decode, inRepositorySnapshot, type DocumentKind, type DocumentMeta, type MutationReceipt, type Repository } from "../model/index.js";
import { templateBody } from "../domain/documents/index.js";
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
  readonly observedAt?: string;
  readonly sources?: readonly string[];
  readonly alternatives?: readonly string[];
  readonly pages?: readonly string[];
  readonly memoryKind?: 'decision' | 'insight' | 'note';
  readonly dryRun?: boolean;
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#create
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#roadmap
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#add
// @concord-implements docs/feature/document-packages/use-case/organize-freeform-research.md
export function createDocument(repo: Repository, kind: DocumentKind, input: CreateDocumentInput): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const id = decode(DocumentName, input.id, 'id');
  if (['use-case', 'issue', 'memory'].includes(kind) && id.toLowerCase() === 'readme') throw new ConcordError('InvalidInput', 'README is reserved for navigation');
  const title = required(input.title, 'title');
  if (input.feature !== undefined && kind !== 'use-case') throw new ConcordError('InvalidInput', 'feature is only valid for use-case');
  if ((input.observedAt !== undefined || (input.sources?.length ?? 0) > 0) && kind !== 'research') throw new ConcordError('InvalidInput', 'observedAt and sources are only valid for research');
  if ((input.alternatives?.length ?? 0) > 0 && kind !== 'design') throw new ConcordError('InvalidInput', 'alternatives are only valid for design');
  if (input.memoryKind !== undefined && kind !== 'memory') throw new ConcordError('InvalidInput', 'memoryKind is only valid for memory');
  if (input.pages !== undefined && !['feature', 'roadmap', 'design'].includes(kind)) throw new ConcordError('InvalidInput', 'pages is only valid for feature, roadmap, and design');
  const selected = decode(Schema.Array(Schema.Literals(TEMPLATE_PAGES)), input.pages ?? [], 'pages');
  if (new Set(selected).size !== selected.length) throw new ConcordError('InvalidInput', 'pages must be unique');
  const requested = TEMPLATE_PAGES.filter(page => selected.includes(page));
  const bodyFor = (name: string) => authorBody(input.body ?? templateBody(name, title, requested));
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
    case 'design': {
      const alternatives = input.alternatives?.map(value => decode(DocumentName, value, 'alternative')) ?? [];
      if (alternatives.length === 0 || alternatives.some(name => name.toLowerCase() === 'readme') || new Set(alternatives).size !== alternatives.length) throw new ConcordError('InvalidInput', 'Design requires unique non-empty alternatives');
      path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, alternatives: alternatives as [string, ...string[]] };
      break;
    }
    case 'engineering': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, kind }; break;
    case 'research': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, ...(input.observedAt === undefined ? {} : { observedAt: required(input.observedAt, 'observedAt') }), sources: input.sources ?? [] }; break;
    case 'memory': {
      const memoryKind = input.memoryKind;
      if (memoryKind === undefined) throw new ConcordError('InvalidInput', 'memoryKind is required');
      path = `memory/${id}.md`;
      template = memoryKind;
      metadata = { format: 'concord.document/v1', id, title, createdAt, kind, type: memoryKind, status: 'captured', relations: [] };
      break;
    }
    case 'issue': path = defaultDocumentPath(kind, id); metadata = { format: 'concord.document/v1', id, title, createdAt, kind, status: 'open', relations: [] }; break;
  }
  const body = kind === 'research' && input.body === undefined ? `# ${title}\n` : bodyFor(template);
  if (kind === 'research' && repo.files(posix.dirname(path)).length > 0) throw new ConcordError('DocumentExists', `${posix.dirname(path)} already contains files; creating an owner would change their ownership`);
  const changes = [{ path, before: null, after: renderDocument(metadata, body) }];
  const allowed = kind === 'feature' || kind === 'roadmap';
  const add = (pagePath: string, name: string) => changes.push({ path: pagePath, before: null, after: authorBody(templateBody(name, title, requested)) });
  if (allowed) for (const page of requested) add(`${posix.dirname(path)}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
  if (kind === 'design') {
    add(`docs/design/${id}/GOALS.md`, 'goals'); add(`docs/design/${id}/LIMITS.md`, 'limits'); add(`docs/design/${id}/DECISION.md`, 'decision-record');
    add(`docs/design/${id}/CASES.md`, 'cases');
    const alternatives = metadata.kind === 'design' ? metadata.alternatives : [];
    for (const alternative of alternatives) {
      const base = `docs/design/${id}/plans/${alternative}`;
      add(`${base}/README.md`, 'design-plan');
      for (const page of requested) add(`${base}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
    }
  }
  for (const change of changes) if (repo.read(change.path) !== undefined) throw new ConcordError('DocumentExists', `${change.path} already exists`);
  return repo.publish(`create-${kind}`, changes, input.dryRun ?? false);
  });
}
