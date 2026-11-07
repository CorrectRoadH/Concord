// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
import { Effect } from 'effect';
import { discoverRoot, git, readRepositoryFileSync } from '../base/workspace/index.ts';
import { ConcordError, failure, type shared_ProjectConfig as ProjectConfig, type WritingGuide } from '../model/index.ts';
import { RuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../base/environment/index.ts';

export function selectWritingGuide(root: string, environment: Readonly<Record<string, string | undefined>> = {}): WritingGuide {
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], environment).split('\0').some(path => {
    if (!path || path.startsWith('.') || path.startsWith('docs/') || path.startsWith('memory/')) return false;
    return path.includes('/') || !(path === 'AGENTS.md' || path === 'concord.config.ts' || path.startsWith('README') || path.startsWith('LICENSE'));
  }) ? 'docs-from-code' : 'docs-from-scratch';
}

export function projectInitializationRequired(input?: string, fromSubdirectory = false, runtime?: RuntimeEnvironmentSnapshot): { root: string; guide: WritingGuide } | undefined {
  const discovered = discoverRoot(input, false, runtime);
  const root = git(discovered, ['rev-parse', '--show-toplevel'], runtime?.env);
  if (!fromSubdirectory && root !== discovered) throw new ConcordError('ProjectRootInvalid', 'The project must be the Git worktree top-level directory');
  return readRepositoryFileSync(root, 'docs/taste.md') === undefined ? { root, guide: selectWritingGuide(root, runtime?.env) } : undefined;
}

export const requireInitializedProject = Effect.fn('requireInitializedProject')(function*(input?: string, fromSubdirectory = false) {
  const runtime = yield* RuntimeEnvironment;
  return yield* Effect.try({
  try: () => {
    const required = projectInitializationRequired(input, fromSubdirectory, runtime);
    if (required) throw new ConcordError('ProjectNotInitialized', 'This repository has not been initialized for Concord.', required);
  }, catch: failure,
  });
});

export function uninitializedDoctor(required: { root: string; guide: WritingGuide }, node: string, configuration: ProjectConfig = {}) {
  return { operation: 'doctor', ok: true, root: required.root, node, configuration,
    writing: { complete: true, ok: true }, missingTestRoots: [], missingSourceRoots: [], codeDeclarations: 0, documents: 0, cases: 0,
    findings: [{ code: 'ProjectNotInitialized', path: 'docs/taste.md', message: 'This repository has not been initialized for Concord.', details: required }],
    nextSteps: ['concord init', `concord --skill ${required.guide}`] };
}
