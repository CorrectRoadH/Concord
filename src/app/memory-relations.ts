import { ConcordError, inRepositorySnapshot, type MutationReceipt, type Repository } from "../model/index.ts";
import { parseReference } from "../model/index.ts";
import { CONTRACT_KINDS } from "../domain/documents/index.ts";
import { changed } from "../domain/documents/index.ts";
import { memory } from "../domain/documents/index.ts";
import { readDocumentReference } from "../domain/documents/index.ts";
import { readDocumentSelector } from "../domain/documents/index.ts";


/** Lifecycle-independent relation helper used by the current Memory command surface. */
export async function linkMemory(repo: Repository, selector: string, target: string, role: 'supports' = 'supports', dryRun = false): Promise<MutationReceipt> {
  return (await inRepositorySnapshot(repo, async () => {
    const record = readDocumentSelector(repo, selector, 'memory');
    const metadata = memory(record);
    const canonical = parseReference(target).ref;
    readDocumentReference(repo, canonical, CONTRACT_KINDS);
    if (metadata.relations.some(relation => relation.role === role && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${role}: ${canonical}`);
    return (await changed(repo, 'link-memory', record, { ...metadata, relations: [...metadata.relations, { role, target: canonical }] }, record.body, dryRun));
  }));
}
