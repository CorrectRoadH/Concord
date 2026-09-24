import type { DocumentRecord } from '../../src/shared';
import { matchingOwners } from '../../src/document-layout';

export function documentHref(document: DocumentRecord, documents: readonly DocumentRecord[]): string {
  if (document.metadata.kind === 'use-case') {
    const owners = matchingOwners(documents, document.metadata.feature, 'feature');
    if (owners.length !== 1) return '/features';
    return `/features/${encodeURIComponent(owners[0]!.metadata.id)}/use-cases/${encodeURIComponent(document.metadata.id)}`;
  }
  const sections = { feature: 'features', engineering: 'engineering', roadmap: 'roadmap', design: 'design', research: 'research', memory: 'memory', issue: 'feedback' };
  const selector = document.metadata.kind === 'memory' ? document.path : document.metadata.id;
  return `/${sections[document.metadata.kind]}/${encodeURIComponent(selector)}`;
}
