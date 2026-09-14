import type { GitEntry } from '../../../src/git-view';

export type Area = 'staged' | 'unstaged' | 'untracked';
export type Category = 'docs' | 'tests';
export interface Selection { readonly path: string; readonly area: Area }
export interface CaseLink { readonly id: string; readonly name: string; readonly file: string; readonly line: number }
export interface TreeNode { readonly name: string; readonly path: string; entry?: GitEntry; readonly children: Map<string, TreeNode> }
export const AREAS = ['staged', 'unstaged', 'untracked'] as const;
export const AREA_LABELS: Record<Area, string> = { staged: '已暂存', unstaged: '未暂存', untracked: '未跟踪' };

export function entriesFor(entries: readonly GitEntry[], area: Area): readonly GitEntry[] {
  if (area === 'untracked') return entries.filter(item => item.untracked);
  if (area === 'staged') return entries.filter(item => !item.untracked && item.index !== ' ');
  return entries.filter(item => !item.untracked && item.worktree !== ' ');
}
export function firstArea(entry: GitEntry): Area { return entry.untracked ? 'untracked' : entry.worktree !== ' ' ? 'unstaged' : 'staged'; }
export function validArea(value: string | null): value is Area { return AREAS.some(area => area === value); }

export function fileTree(entries: readonly GitEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const entry of entries) {
    let node = root;
    for (const name of entry.path.split('/')) {
      let child = node.children.get(name);
      if (!child) { child = { name, path: node.path ? node.path + '/' + name : name, children: new Map() }; node.children.set(name, child); }
      node = child;
    }
    node.entry = entry;
  }
  return root;
}

export function sortedFiles(node: TreeNode): GitEntry[] {
  return [...node.children.values()].sort((a, b) => Number(!a.children.size) - Number(!b.children.size) || a.name.localeCompare(b.name)).flatMap(child => [...(child.entry ? [child.entry] : []), ...sortedFiles(child)]);
}
