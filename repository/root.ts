import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GovernanceConfigurationError,
  readGovernanceConfiguration,
} from 'concord-sdlc/governance-config';

export class RepositoryProfileError extends Error {
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
    throw new RepositoryProfileError('RepositoryRootInvalid', 'Run the repository profile from a consumer Git worktree root.');
  }
  if (realpathSync(top) !== root) {
    throw new RepositoryProfileError('RepositoryRootInvalid', 'Run the repository profile from the Git worktree top-level directory.');
  }
  return root;
}

export function repositoryConfiguration(root = repositoryRoot()) {
  let snapshot;
  try { snapshot = readGovernanceConfiguration(root); }
  catch (cause) {
    if (cause instanceof GovernanceConfigurationError) throw new RepositoryProfileError(cause.code, cause.message);
    throw cause;
  }
  if (snapshot === undefined) {
    throw new RepositoryProfileError('RepositoryProfileMissing', 'This worktree needs concord.repository.json to use concord repo.');
  }
  return {
    root,
    path: snapshot.path,
    source: snapshot.source,
    digest: snapshot.digest,
    config: snapshot.config,
    ...(snapshot.config.host === undefined ? {} : { hostPath: resolve(root, snapshot.config.host) }),
  };
}
