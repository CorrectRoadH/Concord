import type { WorkspaceDocument } from '../../src/model/index';
import { workspaceDocumentHref } from '../../src/model/workspace-display/index.ts';

export function documentHref(document: Pick<WorkspaceDocument, 'path' | 'metadata'>, documents: readonly WorkspaceDocument[]): string {
  return workspaceDocumentHref(document, documents);
}
