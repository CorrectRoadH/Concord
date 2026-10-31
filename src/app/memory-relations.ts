import { ConcordError, inRepositorySnapshot, type MutationReceipt, type Repository } from "../model/index.js";
import { parseReference } from "../model/index.js";
import { CONTRACT_KINDS } from "../domain/documents/index.js";
import { changed } from "../domain/documents/index.js";
import { memory } from "../domain/documents/index.js";
import { readDocumentReference } from "../domain/documents/index.js";
import { readDocumentSelector } from "../domain/documents/index.js";


/** Lifecycle-independent relation helper used by the current Memory command surface. */
export function linkMemory(repo: Repository, selector: string, target: string, role: 'supports' = 'supports', dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'memory');
    const metadata = memory(record);
    const canonical = parseReference(target).ref;
    readDocumentReference(repo, canonical, CONTRACT_KINDS);
    if (metadata.relations.some(relation => relation.role === role && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${role}: ${canonical}`);
    return changed(repo, 'link-memory', record, { ...metadata, relations: [...metadata.relations, { role, target: canonical }] }, record.body, dryRun);
  });
}
