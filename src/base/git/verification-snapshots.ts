// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
// @concord-implements docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#replay
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ConcordError, canonicalPath, inPath } from '../../model/index.ts';
import { git } from '../workspace/index.ts';
import { resolveCommit } from './verification-git.ts';

interface VerificationSnapshot { readonly base: string; readonly greenTree: string; readonly greenCommit: string; readonly fix?: string; }
function withIndex<A>(root: string, environment: Readonly<Record<string, string | undefined>>, use: (invoke: (args: readonly string[], input?: string) => string, index: string) => A): A {
  const directory = mkdtempSync(join(tmpdir(), 'concord-verification-index-'));
  const index = join(directory, 'index');
  const env = { ...Object.fromEntries(Object.entries(environment).filter(([key]) => !key.startsWith('GIT_'))), GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'Concord verification', GIT_AUTHOR_EMAIL: 'verification@concord.invalid', GIT_COMMITTER_NAME: 'Concord verification', GIT_COMMITTER_EMAIL: 'verification@concord.invalid' };
  try {
    return use((args, input) => {
      try { return execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', ...args], { env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 32 * 1024 * 1024 }).trimEnd(); }
      catch { throw new ConcordError('FixUnverifiable', `Cannot ${args[0]} the verification snapshot; resolve index conflicts and retry`); }
    }, index);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function captureVerificationSnapshot(root: string, environment: Readonly<Record<string, string | undefined>>, revision?: string): VerificationSnapshot {
  return withIndex(root, environment, (invoke, index) => {
    const fix = revision === undefined ? undefined : resolveCommit(root, revision, 'FixUnverifiable', environment);
    const base = resolveCommit(root, fix === undefined ? 'HEAD' : `${fix}^1`, 'FixUnverifiable', environment);
    let greenTree: string;
    if (fix === undefined) {
      const original = git(root, ['rev-parse', '--git-path', 'index'], environment);
      copyFileSync(isAbsolute(original) ? original : join(root, original), index);
      greenTree = invoke(['write-tree']);
    } else greenTree = git(root, ['rev-parse', `${fix}^{tree}`], environment);
    if (greenTree === git(root, ['rev-parse', `${base}^{tree}`], environment)) throw new ConcordError('FixUnverifiable', 'No staged changes to verify');
    const greenCommit = fix ?? invoke(['commit-tree', greenTree, '-p', base], 'Concord verification green snapshot\n');
    return { base, greenTree, greenCommit, ...(fix === undefined ? {} : { fix }) };
  });
}
export function deriveVerificationRed(root: string, snapshot: VerificationSnapshot, testRoots: readonly string[], environment: Readonly<Record<string, string | undefined>>) {
  return withIndex(root, environment, invoke => {
    testRoots.forEach(canonicalPath);
    invoke(['read-tree', snapshot.base]);
    const changed = git(root, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', snapshot.base, snapshot.greenTree], environment).split('\0').filter(path => path && testRoots.some(prefix => inPath(path, prefix)));
    const entries = new Map(git(root, ['ls-tree', '-r', '-z', snapshot.greenTree], environment).split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t'); const [mode, , hash] = entry.slice(0, tab).split(' ');
      return [entry.slice(tab + 1), `${mode} ${hash}`] as const;
    }));
    if (changed.length) {
      invoke(['update-index', '-z', '--index-info'], changed.map(path => `0 ${'0'.repeat(40)}\t${path}\0`).join(''));
      const additions = changed.filter(path => entries.has(path));
      if (additions.length) invoke(['update-index', '-z', '--index-info'], additions.map(path => `${entries.get(path)}\t${path}\0`).join(''));
    }
    const redTree = invoke(['write-tree']);
    if (redTree === snapshot.greenTree) throw new ConcordError('FixUnverifiable', 'Red and green snapshots are identical; stage a product fix outside testRoots');
    const redCommit = invoke(['commit-tree', redTree, '-p', snapshot.base], 'Concord verification red snapshot\n');
    return { ...snapshot, redTree, redCommit };
  });
}
