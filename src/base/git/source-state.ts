// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#原生-adapter
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../workspace/index.ts';
import { canonicalPath, ConcordError, digest, objectDigest, type Repository } from '../../model/index.ts';

export function resolveCommit(root: string, revision: string, code = 'CommitUnavailable', environment: Readonly<Record<string, string | undefined>> = {}): string {
  try { return git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], environment); }
  catch { throw new ConcordError(code, `Commit is unavailable: ${revision}`); }
}
export function worktreeIdentity(repo: Repository, allowUnborn = false, environment: Readonly<Record<string, string | undefined>> = {}): string {
  let head: string | null;
  try { head = resolveCommit(repo.root, 'HEAD', 'CommitUnavailable', environment); }
  catch (cause) {
    if (!allowUnborn) throw cause;
    const branch = git(repo.root, ['symbolic-ref', '--quiet', 'HEAD'], environment);
    if (git(repo.root, ['for-each-ref', '--format=%(refname)', branch], environment) !== '') throw cause;
    head = null;
  }
  const paths = [...new Set([...git(repo.root, ['ls-files', '-z'], environment).split('\0'), ...git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z'], environment).split('\0')].filter(Boolean))].sort();
  return objectDigest({ head, status: git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], environment), files: paths.map(path => {
    canonicalPath(path); const target = join(repo.root, path); const stat = lstatSync(target, { throwIfNoEntry: false });
    if (!stat) return { path, absent: true };
    if (stat.isSymbolicLink()) return { path, symlink: readlinkSync(target) };
    if (stat.isDirectory()) return { path, directory: true };
    if (!stat.isFile()) throw new ConcordError('UnsafePath', `Unsupported worktree input: ${path}`);
    return { path, mode: stat.mode & 0o777, digest: digest(readFileSync(target)) };
  }) });
}
