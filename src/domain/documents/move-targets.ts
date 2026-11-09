// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#步骤改写的发布
import { ConcordError, digest, moveRelationTargets, type DocumentRecord, type Repository } from '../../model/index.ts';
import { readDocumentReference } from './documents.ts';

/** Managed owners and exact relationship targets are checked by the document reader. */
export function moveOwnerTargets(repo: Repository, record: DocumentRecord, map: (target: string) => string): { before: string; after: string } {
  if (record.metadata.kind !== 'memory' && record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', record.path);
  const current = readDocumentReference(repo, record.path, [record.metadata.kind]);
  const before = repo.read(current.path);
  if (before === undefined || digest(before) !== record.digest) throw new ConcordError('FileChangedSinceRead', record.path);
  const targets = record.metadata.relations.map(relation => relation.target);
  for (const target of targets) if (map(target) !== target) readDocumentReference(repo, target);
  return { before, after: moveRelationTargets(before, targets, map) };
}
