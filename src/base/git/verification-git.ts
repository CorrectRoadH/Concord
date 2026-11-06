// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { snapshot } from "../workspace/index.ts";
import { git } from "../workspace/index.ts";
import { canonicalPath } from "../../model/index.ts";
import { ConcordError, digest, objectDigest, type Repository, type ConfigSnapshot } from "../../model/index.ts";

export function resolveCommit(root: string, revision: string, code = 'FixUnverifiable'): string {
  try { return git(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]); }
  catch { throw new ConcordError(code, `Commit is unavailable: ${revision}`); }
}
export function firstParentPath(root: string, defect: string, fix: string): string[] {
  if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') throw new ConcordError('FixUnverifiable', 'A shallow clone cannot establish the full first-parent history');
  const history = git(root, ['rev-list', '--first-parent', fix]).split('\n');
  const index = history.indexOf(defect);
  if (index < 0) throw new ConcordError('FixUnverifiable', 'Defect must be a first-parent ancestor of the fix');
  const path = history.slice(0, index + 1).reverse();
  if (path.some(commit => git(root, ['rev-list', '--parents', '-n', '1', commit]).split(' ').length > 2)) throw new ConcordError('FixUnverifiable', 'The verification interval contains a merge commit');
  return path;
}

/** Historical sources are object reads, never a checkout or a cache authority. */
export function commitRepository(repo: Repository, commit: string): Repository {
  const entries = git(repo.root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean).map(entry => {
    const tab = entry.indexOf('\t'); return { mode: entry.slice(0, 6), path: entry.slice(tab + 1) };
  });
  const paths = new Map(entries.map(entry => [entry.path, entry.mode]));
  const sources = new Map<string, string>();
  const read = (path: string): string | undefined => {
    canonicalPath(path);
    if (!paths.has(path)) return undefined;
    if (paths.get(path) !== '100644' && paths.get(path) !== '100755') throw new ConcordError('UnsafePath', `Historical input is not a regular file: ${path}`);
    if (!sources.has(path)) sources.set(path, gitBlob(repo.root, commit, path));
    return sources.get(path);
  };
  const exactRead = read;
  const configSource = exactRead('concord.config.ts');
  const configSnapshot: ConfigSnapshot = configSource === undefined ? { path: 'concord.config.ts', source: '', digest: digest(''), config: {} } : snapshot('concord.config.ts', configSource);
  return { root: repo.root, privateDir: repo.privateDir, config: { ...configSnapshot.config, testRoots: configSnapshot.config.testRoots ?? ['test', 'tests'].filter(root => entries.some(entry => entry.path.startsWith(`${root}/`))), sourceRoots: configSnapshot.config.sourceRoots ?? ['src'].filter(root => entries.some(entry => entry.path.startsWith(`${root}/`))) }, configSnapshot, access: 'read', persistentCache: 'off', read: exactRead, readBytes: path => exactRead(path) === undefined ? undefined : gitBlobBytes(repo.root, commit, path), files: prefix => entries.filter(entry => entry.path === prefix || entry.path.startsWith(`${prefix}/`)).map(entry => entry.path), absolute: path => { canonicalPath(path); return join(repo.root, path); }, publish: () => { throw new ConcordError('ReadOnlyRepository', 'Historical sources cannot publish'); } };
}

import { execFileSync } from "node:child_process";
import { safeRunnerEnvironment } from "../process/index.ts";
export function gitBlobBytes(root: string, commit: string, path: string): Buffer {
  canonicalPath(path);
  try { return execFileSync('git', ['-C', root, 'show', `${commit}:${path}`], { env: safeRunnerEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 10000 }); }
  catch { throw new ConcordError('FixUnverifiable', `Cannot read ${path} in ${commit}`); }
}
export const gitBlob = (root: string, commit: string, path: string): string => gitBlobBytes(root, commit, path).toString('utf8');
export function worktreeIdentity(repo: Repository, allowUnborn = false): string {
  let head: string | null;
  try { head = resolveCommit(repo.root, 'HEAD'); }
  catch (cause) {
    if (!allowUnborn) throw cause;
    const branch = git(repo.root, ['symbolic-ref', '--quiet', 'HEAD']);
    if (git(repo.root, ['for-each-ref', '--format=%(refname)', branch]) !== '') throw cause;
    head = null;
  }
  const paths = [...new Set([...git(repo.root, ['ls-files', '-z']).split('\0'), ...git(repo.root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean))].sort();
  return objectDigest({ head, status: git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), files: paths.map(path => {
    canonicalPath(path); const target = join(repo.root, path); const stat = lstatSync(target, { throwIfNoEntry: false });
    if (!stat) return { path, absent: true };
    if (stat.isSymbolicLink()) return { path, symlink: readlinkSync(target) };
    if (stat.isDirectory()) return { path, directory: true };
    if (!stat.isFile()) throw new ConcordError('UnsafePath', `Unsupported worktree input: ${path}`);
    return { path, mode: stat.mode & 0o777, digest: digest(readFileSync(target)) };
  }) });
}
