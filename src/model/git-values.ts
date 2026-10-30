
export interface GitEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly index: string;
  readonly worktree: string;
  readonly untracked: boolean;
  readonly conflicted: boolean;
}
export interface GitStatus { readonly branch: string; readonly entries: readonly GitEntry[]; readonly baselineCaseIds?: readonly string[]; readonly baselineError?: string; }
export type GitArea = 'staged' | 'unstaged' | 'untracked';
export interface GitDiff {
  readonly path: string;
  readonly area: GitArea;
  readonly patch: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly message?: string;
}
