// @concord-file
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { posix } from 'node:path';
import { fromMarkdown, markdownBody, ConcordError, parseReference, digest, inRepositorySnapshot, type IssueRelation, type MutationReceipt, type Repository } from '../../model/index.js';
import { CONTRACT_KINDS, changed, loadDocuments, readDocumentReference, readDocumentSelector } from '../documents/index.js';
import type { Nodes } from 'mdast';

export function linkIssue(repo: Repository, selector: string, reference: string, dryRun = false, role: IssueRelation['role'] = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    const target = readDocumentReference(repo, reference, role === 'related' ? ['issue'] : role === 'adopts' ? CONTRACT_KINDS : ['memory']);
    if (role === 'related' && target.path === record.path) throw new ConcordError('InvalidReferenceTarget', 'related requires another Issue');
    const canonical = parseReference(reference).ref;
    if (record.metadata.relations.some(item => item.role === role && item.target === canonical)) throw new ConcordError('DuplicateLink', `${role}: ${canonical}`);
    return changed(repo, 'link-issue', record, { ...record.metadata, relations: [...record.metadata.relations, { role, target: canonical }] }, record.body, dryRun);
  });
}
export function unlinkIssue(repo: Repository, selector: string, reference: string, dryRun = false, role: IssueRelation['role'] = 'investigation'): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'issue');
    if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', selector);
    const canonical = parseReference(reference).ref;
    const relations = record.metadata.relations.filter(item => item.role !== role || item.target !== canonical);
    if (relations.length === record.metadata.relations.length) throw new ConcordError('LinkNotFound', `${role}: ${canonical}`);
    return changed(repo, 'unlink-issue', record, { ...record.metadata, relations }, record.body, dryRun);
  });
}
export function adoptIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt { return linkIssue(repo, selector, reference, dryRun, 'adopts'); }
export function retireIssue(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt { return unlinkIssue(repo, selector, reference, dryRun, 'adopts'); }
export function linkFeedbackFeature(repo: Repository, selector: string, reference: string, dryRun = false): MutationReceipt { return adoptIssue(repo, selector, reference, dryRun); }

/** Only authored links and owner relations retain an Issue; regression markers retain historical evidence. */
export function issueReferences(repo: Repository, target: string): readonly { path: string; line?: number }[] {
  const references: { path: string; line?: number }[] = [];
  for (const owner of loadDocuments(repo)) {
    if (owner.path === target || owner.metadata.kind !== 'issue' && owner.metadata.kind !== 'memory') continue;
    if (owner.metadata.relations.some(relation => parseReference(relation.target).path === target)) references.push({ path: owner.path });
  }
  for (const path of [...repo.files('docs'), ...repo.files('memory')].filter(path => /\.mdx?$/u.test(path) && path !== target && !path.startsWith('docs/_template/')).sort()) {
    const source = repo.read(path);
    if (source === undefined) throw new ConcordError('SourceChanged', `${path} disappeared while Issue references were read`);
    const tree = fromMarkdown(markdownBody(source));
    const definitions = new Map<string, string>();
    const index = (node: Nodes): void => { if (node.type === 'definition') definitions.set(node.identifier, node.url); if ('children' in node) node.children.forEach(index); };
    index(tree);
    const visit = (node: Nodes): void => {
      const url = node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier) : undefined;
      if (url !== undefined && !/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(url)) {
        let location: string;
        try { location = decodeURIComponent(url.split(/[?#]/u, 1)[0]!); } catch { throw new ConcordError('InvalidReference', `${path}: invalid link encoding`); }
        if ((location === '' ? path : posix.normalize(posix.join(posix.dirname(path), location))) === target) references.push({ path, line: node.position?.start.line ?? 1 });
      }
      if ('children' in node) node.children.forEach(visit);
    };
    visit(tree);
  }
  return references;
}
export function closeIssue(repo: Repository, selector: string, reason = 'Handled', dryRun = false) {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'issue');
    const references = issueReferences(repo, record.path);
    if (references.length) throw new ConcordError('IssueReferenced', `${record.path} is still linked`, { references });
    const before = repo.read(record.path);
    if (before === undefined || digest(before) !== record.digest) throw new ConcordError('FileChangedSinceRead', `${record.path} changed; reload and retry`);
    const conclusion = `Closed ${record.path}\nReason: ${reason}\n\nPut the lines above in your commit message.`;
    return { ...repo.publish('close-issue', [{ path: record.path, before, after: null }], dryRun), conclusion };
  });
}
