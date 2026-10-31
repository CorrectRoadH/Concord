import { ConcordError, type Repository, type DocumentRecord } from "../../model/index.js";
import { decodeDocumentSource } from "./document-codec.js";
import { documentDisposition, documentPlacementError, isDocumentName, matchingOwners } from "../../model/index.js";

export type LeafOwnerKind = 'memory' | 'issue';
const ownerRoot = (kind: LeafOwnerKind): string => kind === 'memory' ? 'memory' : 'docs/issues';

/** The advanced API retains its existing static roots. Callers own the repository lease. */
export function leafOwners(repo: Repository, kind: LeafOwnerKind): readonly DocumentRecord[] {
  const owners: DocumentRecord[] = [];
  for (const path of repo.files(ownerRoot(kind)).filter(path => path.endsWith('.md'))) {
    const source = repo.read(path);
    if (source === undefined) continue;
    const record = decodeDocumentSource(path, source);
    if (record === undefined || documentDisposition(record.metadata.kind, path, ['memory']) !== 'current') continue;
    if (record.metadata.kind !== kind) throw new ConcordError('InvalidPlacement', `${path}: expected ${kind} owner`);
    const placement = documentPlacementError(kind, path);
    if (placement !== undefined) throw new ConcordError('InvalidPlacement', `${path}: ${placement}`);
    owners.push(record);
  }
  if (kind !== 'memory' && new Set(owners.map(owner => owner.metadata.id)).size !== owners.length) throw new ConcordError('DuplicateIdentity', 'Issue IDs must be unique');
  return owners;
}

export function leafOwnerSelection(repo: Repository, kind: LeafOwnerKind, selector: string): { readonly path: string; readonly record?: DocumentRecord } {
  const directory = ownerRoot(kind);
  const isPath = selector.includes('/');
  if (isPath ? !selector.startsWith(`${directory}/`) || !selector.endsWith('.md') || selector.includes('\\') || selector.split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f#?]/u.test(part)) : !isDocumentName(selector)) throw new ConcordError('InvalidReference', `Unsafe ${kind} selector: ${selector}`);
  const matches = matchingOwners(leafOwners(repo, kind), selector, kind);
  if (matches.length > 1) throw new ConcordError('AmbiguousDocument', `${kind} ID ${selector} is ambiguous; use an actual owner path`);
  const record = matches[0];
  return record === undefined ? { path: isPath ? selector : `${directory}/${selector}.md` } : { path: record.path, record };
}

export function assertSameLeafSelection(repo: Repository, kind: LeafOwnerKind, selector: string, frozen: ReturnType<typeof leafOwnerSelection>): void {
  const current = leafOwnerSelection(repo, kind, selector);
  if (current.path !== frozen.path || current.record?.metadata.id !== frozen.record?.metadata.id || current.record?.digest !== frozen.record?.digest) throw new ConcordError('FileChangedSinceRead', `${selector} changed identity, path, or content after selection`);
}
