import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { Schema } from 'effect';
export class RepositoryProfileError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = code; }
}
export function repositoryRoot(): string {
  const root = realpathSync(process.cwd());
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  let top: string;
  try { top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', env, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new RepositoryProfileError('RepositoryRootInvalid', 'Run the repository profile from a consumer Git worktree root.'); }
  if (top !== root) throw new RepositoryProfileError('RepositoryRootInvalid', 'Run the repository profile from the Git worktree top-level directory.');
  return root;
}
const Configuration = Schema.Struct({ format: Schema.Literal('concord.repository/v1'), host: Schema.String });
export function repositoryConfiguration() {
  const root = repositoryRoot();
  const path = join(root, 'concord.repository.json');
  let source: string;
  try { if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(); source = readFileSync(path, 'utf8'); }
  catch { throw new RepositoryProfileError('RepositoryProfileMissing', 'This worktree needs concord.repository.json to use concord repo.'); }
  let config: typeof Configuration.Type;
  try { config = Schema.decodeUnknownSync(Configuration, { onExcessProperty: 'error' })(JSON.parse(source)); }
  catch { throw new RepositoryProfileError('RepositoryProfileInvalid', 'Expected a concord.repository/v1 configuration with one host path.'); }
  if (isAbsolute(config.host) || /[\\\0\r\n]/u.test(config.host) || config.host.split('/').some(part => !part || part === '.' || part === '..')) throw new RepositoryProfileError('RepositoryHostInvalid', 'Host must be a canonical path inside this worktree.');
  const hostPath = resolve(root, config.host);
  let current = root;
  for (const part of config.host.split('/')) { current = join(current, part); if (lstatSync(current).isSymbolicLink()) throw new RepositoryProfileError('RepositoryHostInvalid', 'Host paths cannot contain symbolic links.'); }
  if (!hostPath.startsWith(root + sep) || !lstatSync(hostPath).isFile()) throw new RepositoryProfileError('RepositoryHostInvalid', 'Host must be a regular file inside this worktree.');
  return { root, hostPath, config, source };
}
