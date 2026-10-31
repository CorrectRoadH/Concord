import { closeIssue } from '../domain/issues/index.js';
import { findDocument, loadDocuments, readDocumentSelector, setAuthor } from "../domain/documents/index.js";
import { buildTrace, requireValidTrace } from "../domain/trace/index.js";
import { ConcordError, digest, inRepositorySnapshot, type DocumentKind, type DocumentRecord, type MutationReceipt, type Repository } from "../model/index.js";


type KnowledgeKind = Extract<DocumentKind, 'memory' | 'issue'>;


// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
function ownerRecords(repo: Repository, kind: KnowledgeKind): readonly DocumentRecord[] {
  return loadDocuments(repo, [kind]).sort((left, right) => left.path.localeCompare(right.path));
}


function summary(record: DocumentRecord) {
  return { path: record.path, id: record.metadata.id, title: record.metadata.title, digest: record.digest,
    ...(record.metadata.kind === 'issue' ? { provider: record.metadata.source?.provider ?? 'local' as const } : {}) };
}

// @concord-end

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#index
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
// @concord-implements docs/feature/local-data-engine/use-case/query-current-projections.md
export function knowledgeIndex(repo: Repository, kind: KnowledgeKind) {
  return inRepositorySnapshot(repo, () => ({ operation: `${kind}-index`, documents: ownerRecords(repo, kind).map(summary) }));
}


// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#recall
function queryTerms(query: string): readonly string[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) throw new ConcordError('InvalidInput', 'recall/search query must be non-empty');
  return terms;
}


function matchingRecords(records: readonly DocumentRecord[], terms: readonly string[]): readonly DocumentRecord[] {
  return records.filter(record => {
    const text = `${record.metadata.title}\n${record.body}`.toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}

// @concord-end

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#recall
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
// @concord-implements docs/feature/local-data-engine/use-case/query-current-projections.md
export function knowledgeSearchRecords(repo: Repository, kind: KnowledgeKind, query: string) {
  return inRepositorySnapshot(repo, () => {
    const terms = queryTerms(query);
    const documents = matchingRecords(ownerRecords(repo, kind), terms);
    return { operation: `${kind}-search`, query, documents: documents.map(record => ({ ...summary(record), body: record.body })) };
  });
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#recall
export function knowledgeSearch(repo: Repository, query: string) {
  return inRepositorySnapshot(repo, () => {
    const terms = queryTerms(query);
    return { operation: 'memory-search', query, memories: matchingRecords(ownerRecords(repo, 'memory'), terms) };
  });
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
export function editKnowledge(repo: Repository, kind: KnowledgeKind, selector: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, kind);
    return setAuthor(repo, record.path, body, expectedDigest, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
export function removeIssue(repo: Repository, selector: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const trace = buildTrace(repo, 'off', { includeCode: false });
    requireValidTrace(trace);
    const record = findDocument(trace.documents, selector, 'issue');
    if (record.digest !== expectedDigest) throw new ConcordError('FileChangedSinceRead', `${record.path} changed; use its current digest`);
    return { ...closeIssue(repo, record.path, 'Handled', dryRun), operation: 'remove-issue' };
  });
}
