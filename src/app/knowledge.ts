import type * as WorkspaceTypes from '../base/workspace/index.ts';
import { closeIssue } from '../domain/issues/index.ts';
import { diagnoseDocuments, findDocument, readDocumentSelector, setAuthor } from "../domain/documents/index.ts";
import { buildTrace, requireValidTrace } from "../domain/trace/index.ts";
import { ConcordError, inRepositorySnapshot, type DocumentKind, type DocumentRecord, type MutationReceipt, type Repository } from "../model/index.ts";
import { searchKnowledgeRecords, type KnowledgeSearchOwner } from './knowledge-search.ts';


type KnowledgeKind = Extract<DocumentKind, 'memory' | 'issue'>;


// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
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
  return inRepositorySnapshot(repo, () => {
    const inventory = diagnoseDocuments(repo, [kind]);
    return { operation: `${kind}-index`, documents: [...inventory.documents].sort((left, right) => left.path.localeCompare(right.path)).map(summary), complete: inventory.complete, findings: inventory.findings };
  });
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#recall
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
// @concord-implements docs/feature/local-data-engine/use-case/query-current-projections.md
export function knowledgeSearchRecords(repo: Repository, kind: KnowledgeKind, query: string, owner?: KnowledgeSearchOwner, signal?: AbortSignal) {
  return searchKnowledgeRecords(repo, kind, query, owner, signal);
}


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#edit
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
export async function editKnowledge(repo: Repository, kind: KnowledgeKind, selector: string, body: string, expectedDigest: string, dryRun = false): Promise<MutationReceipt> {
  return (await inRepositorySnapshot(repo, async () => {
    const record = readDocumentSelector(repo, selector, kind);
    return (await setAuthor(repo, record.path, body, expectedDigest, dryRun));
  }));
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#link
export async function removeIssue(repo: WorkspaceTypes.LocalRepository, selector: string, expectedDigest: string, dryRun = false): Promise<MutationReceipt> {
  return (await inRepositorySnapshot(repo, async () => {
    const trace = (await buildTrace(repo, 'off', { includeCode: false }));
    requireValidTrace(trace);
    const record = findDocument(trace.documents, selector, 'issue');
    if (record.digest !== expectedDigest) throw new ConcordError('FileChangedSinceRead', `${record.path} changed; use its current digest`);
    return { ...(await closeIssue(repo, record.path, 'Handled', dryRun)), operation: 'remove-issue' };
  }));
}
