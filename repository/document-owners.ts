import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConcordError, type DocumentRecord } from 'concord-sdlc/model';
import { decodeDocumentSource } from 'concord-sdlc/document-codec';
import { documentDisposition, documentPlacementError, isDocumentName, matchingOwners } from 'concord-sdlc/document-layout';

export type LeafOwnerKind = 'memory' | 'issue';
const ownerRoot = (kind: LeafOwnerKind): string => kind === 'memory' ? 'memory' : 'docs/issues';

/** The advanced API retains its existing static roots. Callers own the repository lease. */
export function leafOwners(root: string, kind: LeafOwnerKind): readonly DocumentRecord[] {
  const owners: DocumentRecord[] = [];
  const visit = (path: string): void => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return;
    const status = lstatSync(absolute);
    if (status.isSymbolicLink()) throw new ConcordError('InvalidPath', `symbolic links (symlinks) are forbidden: ${path}`);
    if (status.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) visit(`${path}/${entry}`);
    } else if (status.isFile() && path.endsWith('.md')) {
      const record = decodeDocumentSource(path, readFileSync(absolute, 'utf8'));
      if (record === undefined || documentDisposition(record.metadata.kind, path, ['memory']) !== 'current') return;
      if (record.metadata.kind !== kind) throw new ConcordError('InvalidPlacement', `${path}: expected ${kind} owner`);
      const placement = documentPlacementError(kind, path);
      if (placement !== undefined) throw new ConcordError('InvalidPlacement', `${path}: ${placement}`);
      owners.push(record);
    }
  };
  // Check every ancestor before walking so a directory symlink cannot redirect the inventory.
  let parent = root;
  if (lstatSync(parent).isSymbolicLink()) throw new ConcordError('InvalidPath', 'repository root is a symlink');
  for (const part of ownerRoot(kind).split('/')) {
    parent = join(parent, part);
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw new ConcordError('InvalidPath', `symbolic links (symlinks) are forbidden: ${parent}`);
  }
  visit(ownerRoot(kind));
  if (kind !== 'memory' && new Set(owners.map(owner => owner.metadata.id)).size !== owners.length) throw new ConcordError('DuplicateIdentity', 'Issue IDs must be unique');
  return owners;
}

export function leafOwnerSelection(root: string, kind: LeafOwnerKind, selector: string): { readonly path: string; readonly record?: DocumentRecord } {
  const directory = ownerRoot(kind);
  const isPath = selector.includes('/');
  if (isPath ? !selector.startsWith(`${directory}/`) || !selector.endsWith('.md') || selector.includes('\\') || selector.split('/').some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f#?]/u.test(part)) : !isDocumentName(selector)) throw new ConcordError('InvalidReference', `Unsafe ${kind} selector: ${selector}`);
  const matches = matchingOwners(leafOwners(root, kind), selector, kind);
  if (matches.length > 1) throw new ConcordError('AmbiguousDocument', `${kind} ID ${selector} is ambiguous; use an actual owner path`);
  const record = matches[0];
  return record === undefined ? { path: isPath ? selector : `${directory}/${selector}.md` } : { path: record.path, record };
}

export function assertSameLeafSelection(root: string, kind: LeafOwnerKind, selector: string, frozen: ReturnType<typeof leafOwnerSelection>): void {
  const current = leafOwnerSelection(root, kind, selector);
  if (current.path !== frozen.path || current.record?.metadata.id !== frozen.record?.metadata.id || current.record?.digest !== frozen.record?.digest) throw new ConcordError('PreimageChanged', `${selector} changed identity, path, or content after selection`);
}
