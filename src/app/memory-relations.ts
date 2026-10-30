import { ConcordError, inRepositorySnapshot, type MutationReceipt, type Repository } from "../model/index.js";
import { parseReference } from "../model/index.js";
import { CONSTITUTION_PATH, clauseIndex, showConstitution } from "../domain/constitution/index.js";
import { CONTRACT_KINDS } from "../domain/documents/index.js";
import { changed } from "../domain/documents/index.js";
import { memory } from "../domain/documents/index.js";
import { readDocumentReference } from "../domain/documents/index.js";
import { readDocumentSelector } from "../domain/documents/index.js";


/** A Decision may be promoted to the constitution or one of its clauses and paragraphs. */
export function constitutionPromotion(repo: Repository, target: string): string | undefined {
  const parsed = parseReference(target);
  if (parsed.path !== CONSTITUTION_PATH) return undefined;
  if (parsed.anchor !== undefined && !clauseIndex(showConstitution(repo).clauses).has(parsed.anchor)) throw new ConcordError('AnchorNotFound', `Constitution clause ${parsed.anchor} does not exist`);
  return parsed.ref;
}



/** Lifecycle-independent relation helper used by the current Memory command surface. */
export function linkMemory(repo: Repository, selector: string, target: string, role: 'supports' | 'amends' = 'supports', dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'memory');
    const metadata = memory(record);
    const canonical = parseReference(target).ref;
    if (role === 'amends') {
      if (constitutionPromotion(repo, canonical) === undefined) throw new ConcordError('InvalidReferenceTarget', 'amends requires the constitution or one of its clauses');
    } else readDocumentReference(repo, canonical, CONTRACT_KINDS);
    if (metadata.relations.some(relation => relation.role === role && relation.target === canonical)) throw new ConcordError('DuplicateLink', `${role}: ${canonical}`);
    return changed(repo, 'link-memory', record, { ...metadata, relations: [...metadata.relations, { role, target: canonical }] }, record.body, dryRun);
  });
}
