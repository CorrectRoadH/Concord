// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
// @concord-implements docs/feature/local-data-engine/use-case/query-current-projections.md
import { findDocument, loadDocuments, setAuthor } from './documents.js';
import { buildTrace, requireValidTrace } from './trace.js';
import { ConcordError, digest, inRepositorySnapshot, type DocumentKind, type DocumentRecord, type MutationReceipt, type Repository } from './shared.js';

type KnowledgeKind = Extract<DocumentKind, 'memory' | 'issue'>;

function ownerRecords(repo: Repository, kind: KnowledgeKind): readonly DocumentRecord[] {
  return loadDocuments(repo).filter(record => record.metadata.kind === kind).sort((left, right) => left.path.localeCompare(right.path));
}

function summary(record: DocumentRecord) {
  return { path: record.path, id: record.metadata.id, title: record.metadata.title, digest: record.digest,
    ...(record.metadata.kind === 'memory' ? { memoryKind: record.metadata.memoryKind, state: record.metadata.state } :
      record.metadata.kind === 'issue' ? { state: record.metadata.state, provider: record.metadata.source?.provider ?? 'local' as const } : {}) };
}

export function knowledgeIndex(repo: Repository, kind: KnowledgeKind) {
  return inRepositorySnapshot(repo, () => ({ operation: `${kind}-index`, documents: ownerRecords(repo, kind).map(summary) }));
}

export function knowledgeRecall(repo: Repository, kind: KnowledgeKind, query: string) {
  return inRepositorySnapshot(repo, () => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) throw new ConcordError('InvalidInput', 'recall query must be non-empty');
    const documents = ownerRecords(repo, kind).filter(record => `${record.metadata.title}\n${record.body}`.toLocaleLowerCase().includes(needle));
    return { operation: `${kind}-recall`, query, documents: documents.map(record => ({ ...summary(record), body: record.body })) };
  });
}

export function editKnowledge(repo: Repository, kind: KnowledgeKind, selector: string, body: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = findDocument(loadDocuments(repo), selector, kind);
    return setAuthor(repo, record.path, body, expectedDigest, dryRun);
  });
}

function isUnlinkedDraft(record: DocumentRecord): boolean {
  if (record.metadata.kind !== 'issue') return false;
  const issue = record.metadata;
  return issue.state === 'draft' && issue.source === undefined && issue.origin === undefined && issue.closure === undefined &&
    issue.history.length === 0 && issue.memoryRelations.length === 0 && issue.adoptions.current.length === 0 && issue.adoptions.history.length === 0;
}

export function removeIssue(repo: Repository, selector: string, expectedDigest: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const trace = buildTrace(repo, 'off', { includeCode: false });
    requireValidTrace(trace);
    const record = findDocument(trace.documents, selector, 'issue');
    if (record.digest !== expectedDigest) throw new ConcordError('PreimageChanged', `${record.path} changed; use its current digest`);
    if (!isUnlinkedDraft(record)) throw new ConcordError('IssueNotRemovable', `${record.path} has a source, relationship, or lifecycle history`);
    for (const edge of trace.edges) {
      if (edge.from === record.path) continue;
      const target = edge.to.split('#', 1)[0]!;
      if (target === record.path || target === record.metadata.id) throw new ConcordError('IssueNotRemovable', `${record.path} has an incoming Trace relationship`);
    }
    const before = repo.read(record.path);
    if (before === undefined || digest(before) !== record.digest) throw new ConcordError('PreimageChanged', `${record.path} changed; reload and retry`);
    return repo.publish('remove-issue', [{ path: record.path, before, after: null }], dryRun);
  });
}
