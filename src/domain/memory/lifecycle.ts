import { ConcordError, inRepositorySnapshot, type MutationReceipt, type Repository } from "../../model/index.js";
import { supersededMemory } from "../../model/index.js";
import { resolveReference } from "../documents/index.js";
import { now } from "../documents/index.js";
import { required } from "../documents/index.js";
import { changed } from "../documents/index.js";
import { memory } from "../documents/index.js";
import { loadDocuments } from "../documents/index.js";
import { readDocumentSelector } from "../documents/index.js";
import { findDocument } from "../documents/index.js";



// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
export function activateMemory(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const record = readDocumentSelector(repo, selector, 'memory');
  const metadata = memory(record);
  if (metadata.status !== 'captured') throw new ConcordError('InvalidMemoryState', 'Only captured Memory can be activated');
  if (metadata.type === 'note') throw new ConcordError('InvalidMemoryState', 'A note cannot be activated without explicit classification');
  const at = now();
  required(reason, 'reason');
  return changed(repo, 'activate-memory', record, { ...metadata, status: 'current' }, record.body, dryRun);
  });
}



// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
export function supersedeMemory(repo: Repository, selector: string, replacement: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'memory'); const next = findDocument(documents, replacement, 'memory');
  let cursor = next; const seen = new Set<string>();
  while (cursor.metadata.kind === 'memory' && cursor.metadata.supersededBy !== undefined) {
    if (cursor.path === record.path || seen.has(cursor.path)) throw new ConcordError('ReferenceCycle', 'Memory supersession would create a cycle');
    seen.add(cursor.path); cursor = resolveReference(repo, documents, cursor.metadata.supersededBy, ['memory']);
  }
  return changed(repo, 'supersede-memory', record, supersededMemory(memory(record), memory(next), next.path, reason, now()), record.body, dryRun);
  });
}
