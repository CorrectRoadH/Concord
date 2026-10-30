import { Schema } from "effect";
import { ConcordError, IssueClosureSchema, MEMORY_RELATION_KINDS, type IssueClosure, type IssueRelation, decode, inRepositorySnapshot, type MutationReceipt, type Repository } from "../../model/index.js";
import { resolveReference } from "../documents/index.js";
import { parseReference } from "../../model/index.js";
import { CONTRACT_KINDS } from "../documents/index.js";
import { now } from "../documents/index.js";
import { required } from "../documents/index.js";
import { changed } from "../documents/index.js";
import { loadDocuments } from "../documents/index.js";
import { readDocumentReference } from "../documents/index.js";
import { readDocumentSelector } from "../documents/index.js";
import { findDocument } from "../documents/index.js";
import { checkIssueClosure } from "../documents/index.js";


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function linkIssue(repo: Repository, selector: string, memoryRef: string, dryRun = false, kind: Exclude<IssueRelation['role'], 'adopts'> | 'adopts' = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  if (kind === 'adopts') return adoptIssue(repo, selector, memoryRef, dryRun);
  const record = readDocumentSelector(repo, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue cannot gain links');
  decode(Schema.Literals(MEMORY_RELATION_KINDS), kind, 'relation kind');
  const target = readDocumentReference(repo, memoryRef, kind === 'related' ? ['issue'] : ['memory']); const canonical = parseReference(memoryRef).ref;
  if (target.metadata.kind === 'memory' && !['current', 'superseded'].includes(target.metadata.status)) throw new ConcordError('InvalidMemoryState', 'Issue relations require current or superseded Memory');
  if (kind === 'related' && target.path === record.path) throw new ConcordError('InvalidReferenceTarget', 'related requires another Issue');
  if (record.metadata.relations.some((relation) => relation.target === canonical && relation.role === kind)) throw new ConcordError('DuplicateLink', `${canonical} is already linked`);
  return changed(repo, 'link-issue', record, { ...record.metadata, relations: [...record.metadata.relations, { role: kind, target: canonical }] }, record.body, dryRun);
  });
}
export function unlinkIssue(repo: Repository, selector: string, reference: string, dryRun = false, role: Exclude<IssueRelation['role'], 'adopts'> | 'adopts' = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    if (role === 'adopts') return retireIssue(repo, selector, reference, dryRun);
    const record = readDocumentSelector(repo, selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue must be reopened before unlinking');
    const canonical = parseReference(reference).ref;
    const relations = record.metadata.relations.filter(item => item.role !== role || item.target !== canonical);
    if (relations.length === record.metadata.relations.length) throw new ConcordError('LinkNotFound', `${role}: ${canonical}`);
    return changed(repo, 'unlink-issue', record, { ...record.metadata, relations: relations }, record.body, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
export function linkFeedbackFeature(repo: Repository, selector: string, featureRef: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const target = findDocument(loadDocuments(repo), featureRef, 'feature');
    return adoptIssue(repo, selector, target.path, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function closeIssue(repo: Repository, selector: string, closureInput: string | IssueClosure, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.status !== 'open' && !(record.metadata.closure?.kind === 'fixed' && record.metadata.closure.verification === undefined)) throw new ConcordError('InvalidIssueState', 'Issue is already closed');
  const closure = decode(IssueClosureSchema, typeof closureInput === 'string' ? { kind: 'closed', reason: closureInput } : closureInput, 'Issue closure');
  const at = now(); const why = closure.kind === 'closed' ? closure.reason : closure.kind;
  const metadata = { ...record.metadata, status: 'closed' as const, closure };
  const candidate = { ...record, metadata };
  const findings = checkIssueClosure(repo, documents.map(document => document.path === record.path ? candidate : document), candidate);
  if (findings.length > 0) throw new ConcordError(findings[0]!.code, findings[0]!.message, { findings });
  return changed(repo, 'close-issue', record, metadata, record.body, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function adoptIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'issue');
    if (record.metadata.kind !== 'issue' || record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Only a draft Issue can adopt a contract');
    const parsed = parseReference(reference);
    const target = resolveReference(repo, documents, reference, CONTRACT_KINDS);
    const canonical = parsed.ref;
    if (record.metadata.relations.some(relation => relation.role === 'adopts' && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${canonical} is already adopted`);
    return changed(repo, 'adopt-issue', record, { ...record.metadata, relations: [...record.metadata.relations, { role: 'adopts', target: canonical }] }, record.body, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function retireIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = findDocument(loadDocuments(repo), selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    const canonical = parseReference(reference).ref;
    if (!record.metadata.relations.some(relation => relation.role === 'adopts' && relation.target === canonical)) throw new ConcordError('InvalidIssueState', `${canonical} is not a current adoption`);
    if (record.metadata.status !== 'open') throw new ConcordError('InvalidIssueState', 'Closed Issue must be reopened before unlinking');
    return changed(repo, 'retire-issue', record, { ...record.metadata, relations: record.metadata.relations.filter(relation => relation.role !== 'adopts' || relation.target !== canonical) }, record.body, dryRun);
  });
}


// @concord-code
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md#操作-spec
export function reopenIssue(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = findDocument(loadDocuments(repo), selector, 'issue');
    if (record.metadata.kind !== 'issue' || record.metadata.status !== 'closed') throw new ConcordError('InvalidIssueState', 'Only a closed Issue can reopen');
    const why = required(reason, 'reason'); const { closure: _, ...metadata } = record.metadata;
    return changed(repo, 'reopen-issue', record, { ...metadata, status: 'open' }, record.body, dryRun);
  });
}
