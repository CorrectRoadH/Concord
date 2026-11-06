// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import type { Repository } from '../../model/index.ts';
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';

const captured = new WeakMap<Repository, RuntimeEnvironmentSnapshot>();

/** Repository wrappers retain their owner's complete immutable call input. */
export function bindRepositoryRuntime(repo: Repository, runtime: RuntimeEnvironmentSnapshot): void {
  captured.set(repo, runtime);
}

/** Synchronous consumers keep the repository's captured environment. */
export const repositoryRuntime = (repo: Repository) => captured.get(repo) ?? makeRuntimeEnvironment(repo.root, repo.environment?.() ?? {});
