import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export class RepositoryRootError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = code;
  }
}

export function repositoryRoot(): string {
  const root = realpathSync(process.cwd());
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  let top: string;
  try {
    top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', env, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new RepositoryRootError('RepositoryRootInvalid', 'Run the repository API from a Git worktree root.');
  }
  if (realpathSync(top) !== root) {
    throw new RepositoryRootError('RepositoryRootInvalid', 'Run the repository API from the Git worktree top-level directory.');
  }
  return root;
}
