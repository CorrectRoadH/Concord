// @concord-file
// @concord-implements docs/feature/local-sdlc/README.md
import { execFile } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Effect, Schema } from 'effect';
import { parseTestDeclarations } from './annotations.js';
import { createMemoryHawdb, type HawdbDatabase } from './hawdb-native.js';
import { ConcordError, decode, objectDigest } from './shared.js';
import { typescriptPackageVersion } from './typescript-host.js';

export interface GitEntry {
  readonly path: string;
  readonly previousPath?: string;
  readonly index: string;
  readonly worktree: string;
  readonly untracked: boolean;
  readonly conflicted: boolean;
}
export interface GitStatus { readonly branch: string; readonly entries: readonly GitEntry[]; readonly baselineCaseIds?: readonly string[]; readonly baselineError?: string; }
export interface GitBaselineCache { database?: HawdbDatabase; }
const BaselineSchema = Schema.Struct({ root: Schema.String, revision: Schema.String, roots: Schema.String, parser: Schema.String, caseIds: Schema.Array(Schema.String) });
const BASELINE_PARSER = `typescript-ast/${typescriptPackageVersion()}/concord-marker-baseline/v4`;
export function closeGitBaselineCache(cache: GitBaselineCache): void { cache.database?.close(); cache.database = undefined; }
export type GitArea = 'staged' | 'unstaged' | 'untracked';
export interface GitDiff {
  readonly path: string;
  readonly area: GitArea;
  readonly patch: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly message?: string;
}

const OUTPUT_LIMIT = 2 * 1024 * 1024;
const runGit = Effect.fn('view.runGit')(function*(root: string, args: readonly string[], allowFailure: boolean | readonly number[] = false) {
  return yield* Effect.callback<{ stdout: string; truncated: boolean }, ConcordError>(resume => {
    const env = { ...process.env };
    for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
    env.GIT_TERMINAL_PROMPT = '0';
    const child = execFile('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args], {
      env, encoding: 'utf8', timeout: 10000, maxBuffer: OUTPUT_LIMIT,
    }, (error, stdout) => {
      if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resume(Effect.succeed({ stdout, truncated: true }));
      else if (error && !(allowFailure === true || Array.isArray(allowFailure) && allowFailure.includes(Number(error.code)))) resume(Effect.fail(new ConcordError('GitFailed', 'Could not inspect Git changes.')));
      else resume(Effect.succeed({ stdout, truncated: false }));
    });
    return Effect.sync(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  });
});

export const getGitStatus = Effect.fn('view.getGitStatus')(function*(root: string, includeTestBaseline = false, baselineCache?: GitBaselineCache, testRoots?: readonly string[]): Effect.fn.Return<GitStatus, ConcordError> {
  const result = yield* runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.truncated) return yield* Effect.fail(new ConcordError('GitOutputLimit', 'Git status exceeds 2 MiB; narrow the working tree changes before inspecting them.'));
  const records = result.stdout.split('\0');
  const entries: GitEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    if (record.length < 4 || record[2] !== ' ') return yield* Effect.fail(new ConcordError('GitInvalidOutput', 'Malformed Git status record.'));
    const index = record[0]!, worktree = record[1]!, path = record.slice(3);
    const previousPath = /[RC]/u.test(index + worktree) ? records[++i] : undefined;
    if (previousPath === '') return yield* Effect.fail(new ConcordError('GitInvalidOutput', 'Missing Git rename source.'));
    entries.push({ path, ...(previousPath === undefined ? {} : { previousPath }), index, worktree, untracked: index === '?', conflicted: index === 'U' || worktree === 'U' || index + worktree === 'AA' || index + worktree === 'DD' });
  }
  const branch = yield* runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true);
  const head = branch.stdout.trim() || (yield* runGit(root, ['rev-parse', '--short', 'HEAD'], true)).stdout.trim();
  const baseline = includeTestBaseline ? yield* readTestBaseline(root, baselineCache, testRoots).pipe(
    Effect.map(baselineCaseIds => ({ baselineCaseIds })),
    Effect.catch(cause => Effect.succeed({ baselineError: `${cause.code}: ${cause.message}` })),
  ) : {};
  return { ...baseline, branch: branch.stdout.trim() || (head ? `Detached at ${head}` : 'Unborn HEAD'), entries };
});

const readTestBaseline = Effect.fn('view.readTestBaseline')(function*(root: string, cache?: GitBaselineCache, testRoots?: readonly string[]) {
  const baselineCaseIds: string[] = [];
    const roots = testRoots === undefined ? '*' : [...testRoots].sort().join('\0');
    const revision = yield* runGit(root, ['rev-parse', '--verify', 'HEAD'], true);
    const revisionId = revision.stdout.trim();
    const key = objectDigest({ root, revision: revisionId, roots, parser: BASELINE_PARSER });
    if (cache && revisionId) try {
      cache.database ??= createMemoryHawdb();
      const row = cache.database.get('git_baseline', [key])[0];
      if (row) {
        const value = decode(BaselineSchema, JSON.parse(row.payload), 'Git baseline cache');
        if (value.root === root && value.revision === revisionId && value.roots === roots && value.parser === BASELINE_PARSER) return [...value.caseIds];
      }
    } catch { /* invalid cache is rebuilt from HEAD */ }
    if (revision.stdout.trim()) {
      const candidates = yield* runGit(root, ['grep', '-l', '-z', '-F', '-e', '@feature', '-e', '@use-case', revision.stdout.trim()], [1]);
      if (candidates.truncated) return yield* Effect.fail(new ConcordError('GitOutputLimit', 'Test baseline inventory exceeds the preview limit.'));
      for (const object of candidates.stdout.split('\0').filter(object => object.includes(':'))) {
        const path = object.slice(object.indexOf(':') + 1);
        if (testRoots !== undefined && !testRoots.some(root => root === '.' || path === root || path.startsWith(root.replace(/\/$/u, '') + '/'))) continue;
        const source = yield* runGit(root, ['show', object]);
        if (source.truncated) return yield* Effect.fail(new ConcordError('GitOutputLimit', 'A test baseline source exceeds the preview limit.'));
        const parsed = parseTestDeclarations(path, source.stdout);
        if (parsed.findings.length) return yield* Effect.fail(new ConcordError('GitTestBaselineInvalid', 'The HEAD test declarations have findings; repair the baseline before comparing added cases.'));
        baselineCaseIds.push(...parsed.cases.map(item => item.id));
      }
    }
  const caseIds = [...new Set(baselineCaseIds)];
  if (cache) try {
    cache.database ??= createMemoryHawdb();
    cache.database.put('git_baseline', [{ key, payload: JSON.stringify({ root, revision: revisionId, roots, parser: BASELINE_PARSER, caseIds }) }]);
  } catch { /* baseline remains derived from HEAD */ }
  return [...caseIds];
});

function untrackedDiff(root: string, path: string): GitDiff {
  const base = resolve(root), target = resolve(base, path);
  const empty = { path, area: 'untracked' as const, patch: '', binary: false, truncated: false };
  if (!target.startsWith(base + sep) || path.split('/').some(segment => segment === '..' || segment === '.git')) throw new ConcordError('UnsafePath', 'The Git path is outside the working tree.');
  let current = base;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    if (lstatSync(current).isSymbolicLink()) return { ...empty, message: 'Symbolic link: its target is not read.' };
  }
  const stat = lstatSync(target);
  if (!stat.isFile()) return { ...empty, message: 'This entry is not a regular file.' };
  if (stat.size > OUTPUT_LIMIT / 2) return { ...empty, truncated: true, message: 'New file exceeds the 1 MiB preview limit.' };
  const bytes = readFileSync(target);
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { ...empty, binary: true, message: 'Binary or non-UTF-8 file.' }; }
  if (bytes.includes(0)) return { ...empty, binary: true, message: 'Binary file.' };
  const lines = source === '' ? [] : source.split('\n');
  if (source.endsWith('\n')) lines.pop();
  const label = (value: string) => /[\s"\\]/u.test(value) ? JSON.stringify(value) : value;
  const oldLabel = label(`a/${path}`), newLabel = label(`b/${path}`);
  return { ...empty, patch: `diff --git ${oldLabel} ${newLabel}\nnew file mode ${(stat.mode & 0o111) ? '100755' : '100644'}\n--- /dev/null\n+++ ${newLabel}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}\n`).join('')}${source && !source.endsWith('\n') ? '\\ No newline at end of file\n' : ''}` };
}

export const getGitDiff = Effect.fn('view.getGitDiff')(function*(root: string, path: string, area: GitArea): Effect.fn.Return<GitDiff, ConcordError> {
  const status = yield* getGitStatus(root);
  const entry = status.entries.find(item => item.path === path);
  if (!entry) return yield* Effect.fail(new ConcordError('GitChangeNotFound', 'This file no longer has Git changes; refresh the panel.'));
  if (area === 'untracked') {
    if (!entry.untracked) return yield* Effect.fail(new ConcordError('GitChangeNotFound', 'This file is already tracked.'));
    return yield* Effect.try({ try: () => untrackedDiff(root, path), catch: cause => cause instanceof ConcordError ? cause : new ConcordError('GitReadFailed', 'The new file changed or cannot be read; refresh the panel.') });
  }
  if (entry.untracked || (area === 'staged' ? entry.index : entry.worktree) === ' ') return yield* Effect.fail(new ConcordError('GitChangeNotFound', `There are no ${area} changes for this file.`));
  const paths = entry.previousPath ? [entry.previousPath, path] : [path];
  const result = yield* runGit(root, ['diff', ...(area === 'staged' ? ['--cached'] : []), '--no-ext-diff', '--no-textconv', '--no-color', '--unified=4', '--submodule=short', '--', ...paths]);
  return { path, area, patch: result.stdout, binary: /^Binary files .* differ$/mu.test(result.stdout), truncated: result.truncated, ...(entry.conflicted ? { message: 'Unmerged file: resolve the conflict with your Git tools.' } : {}) };
});
