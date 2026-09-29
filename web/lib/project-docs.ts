// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import type { WorkspacePage, WorkspaceProjectionSnapshot } from '../../src/view-contract';
import { DOCUMENT_ROOTS } from '../../src/document-layout';

const ROOT_RANK = ['docs/README.md', 'docs/architecture.md', 'docs/constitution.md', 'docs/concepts.md', 'docs/concord.md'];

function under(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function projectDocPages(snapshot: WorkspaceProjectionSnapshot): readonly WorkspacePage[] {
  const memoryRoots = (snapshot.project?.memorySources ?? [{ path: 'memory' }]).map(source => source.path);
  const roots = [...DOCUMENT_ROOTS, ...memoryRoots];
  return snapshot.pages
    .filter(page => page.path.endsWith('.md') && (page.path.startsWith('docs/') && !roots.some(root => under(page.path, root)) || page.documentPath === undefined && memoryRoots.some(root => under(page.path, root))))
    .sort((left, right) => projectDocSort(left.path).localeCompare(projectDocSort(right.path)));
}

/** Titles come from the projected single-line derivedTitle, never a body excerpt. */
export function projectDocTitle(page: Pick<WorkspacePage, 'path' | 'derivedTitle'>): string {
  if (page.path.startsWith('docs/_template/')) return page.path.slice('docs/'.length);
  return page.derivedTitle ?? (page.path.startsWith('docs/') ? page.path.slice('docs/'.length) : page.path);
}

export function projectDocHref(path: string): string {
  return `/docs?file=${encodeURIComponent(path)}`;
}

function projectDocSort(path: string): string {
  const rank = ROOT_RANK.indexOf(path);
  if (rank >= 0) return `0${rank}`;
  if (path.startsWith('docs/_template/')) return `2${path}`;
  return `1${path}`;
}
