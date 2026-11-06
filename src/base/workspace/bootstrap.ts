// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { ConcordError } from '../../model/index.ts';
const MAX_BYTES = 32 * 1024 * 1024;
const errno = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
function present(path: string): boolean { try { lstatSync(path); return true; } catch (cause) { if (errno(cause, 'ENOENT')) return false; throw cause; } }

export function git(root: string, args: readonly string[], environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const env = { ...environment };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try { return execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BYTES, timeout: 10000 }).trimEnd(); }
  catch { throw new ConcordError('GitFailed', `Git could not ${args[0] ?? 'inspect'} the selected repository`); }
}
/** Conservative APFS collision key: over-rejection is safer than a partial publication. */
export function darwinPathCollisionKey(path: string): string {
  return path.split('/').map((part) => part.normalize('NFKD').toUpperCase().toLowerCase().normalize('NFD')).join('/');
}

export function hasExactDarwinEntry(entries: readonly Buffer[], requested: string): boolean {
  const bytes = Buffer.from(requested);
  return entries.some((entry) => entry.equals(bytes));
}

export function assertNoSymlink(path: string): void {
  const absolute = resolve(path);
  let part: string = sep;
  for (const segment of absolute.slice(sep.length).split(sep)) {
    const target = join(part, segment);
    if (process.platform === 'darwin' && present(part)) {
      const entries = readdirSync(part, { encoding: 'buffer' });
      if (!hasExactDarwinEntry(entries, segment)) {
        const alias = entries.find((entry) => darwinPathCollisionKey(entry.toString('utf8')) === darwinPathCollisionKey(segment));
        if (alias !== undefined || present(target)) throw new ConcordError('UnsafePath', `Path component spelling does not match the directory entry: ${target}`);
        break;
      }
    }
    part = target;
    let stat;
    try { stat = lstatSync(part); }
    catch (cause) { if (!errno(cause, 'ENOENT')) throw cause; }
    if (stat?.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${part}`);
  }
}

export function discoverRoot(input?: string, initialize = false): string {
  let cursor = resolve(input ?? process.cwd());
  assertNoSymlink(cursor);
  if (initialize || input !== undefined) return cursor;
  try { return git(cursor, ['rev-parse', '--show-toplevel']); }
  catch { throw new ConcordError('ProjectNotFound', 'The current directory is not in a Git worktree'); }
}
