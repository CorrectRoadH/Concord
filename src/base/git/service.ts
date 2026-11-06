import { Context, Effect, Layer } from 'effect';
import { ConcordError } from '../../model/index.ts';
import { OwnedProcess, hasConfirmedOwnedGroupCleanup } from '../process/index.ts';

export const OUTPUT_LIMIT = 2 * 1024 * 1024;
export function previewGitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith('GIT_')) delete environment[name];
  return { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_ATTR_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}
export interface GitService {
  readonly run: (root: string, args: readonly string[], allowFailure?: boolean | readonly number[]) => Effect.Effect<{ readonly stdout: string; readonly truncated: boolean }, ConcordError>;
  readonly preview: (cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv, limit?: number, input?: string) => Effect.Effect<Buffer, ConcordError>;
}
export class Git extends Context.Service<Git, GitService>()('concord/base/git/Git') {
  static readonly layer = Layer.effect(Git, Effect.gen(function*() {
    const owned = yield* OwnedProcess;
    return Git.of({
      run: Effect.fn('Git.run')(function*(root: string, args: readonly string[], allowFailure: boolean | readonly number[] = false) {
        const env = { ...process.env };
        for (const name of Object.keys(env)) if (name.startsWith('GIT_')) delete env[name];
        env.GIT_TERMINAL_PROMPT = '0';
        const result = yield* Effect.scoped(owned.run(['git', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', root, ...args], {
          cwd: root, env, timeoutMs: 10_000, stdoutLimitBytes: OUTPUT_LIMIT, stderrLimitBytes: OUTPUT_LIMIT, outputLimitBytes: OUTPUT_LIMIT * 2,
        })).pipe(Effect.mapError(() => new ConcordError('GitFailed', 'Could not inspect Git changes.')));
        if (!hasConfirmedOwnedGroupCleanup(result)) return yield* Effect.fail(new ConcordError('GitFailed', 'Could not inspect Git changes.'));
        if (result.outputLimitExceeded) return { stdout: result.stdout, truncated: true };
        if (result.error !== undefined || result.timedOut || result.cancelled || result.signal !== null || result.exitCode !== 0 && !(allowFailure === true || Array.isArray(allowFailure) && allowFailure.includes(result.exitCode ?? -1))) return yield* Effect.fail(new ConcordError('GitFailed', 'Could not inspect Git changes.'));
        return { stdout: result.stdout, truncated: false };
      }),
      preview: Effect.fn('Git.preview')(function*(cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv, limit = OUTPUT_LIMIT, input?: string) {
        const chunks: Buffer[] = [];
        const result = yield* Effect.scoped(owned.run(['git', '--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', `core.attributesFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, ...args], {
          cwd, env: environment, stdin: input ?? '', timeoutMs: 10_000, stdoutLimitBytes: limit, stderrLimitBytes: 65_536, outputLimitBytes: limit + 65_536,
          stream: { ready: () => {}, stdout: chunk => { chunks.push(Buffer.from(chunk)); } },
        })).pipe(Effect.mapError(cause => new ConcordError('PreviewGitFailed', cause.detail)));
        if (result.timedOut) return yield* Effect.fail(new ConcordError('PreviewGitTimeout', 'Git exceeded its 10 second budget.'));
        if (result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('PreviewBudgetExceeded', 'Git output exceeds the export budget.'));
        if (!hasConfirmedOwnedGroupCleanup(result) || result.error !== undefined || result.cancelled || result.signal !== null || result.exitCode !== 0) return yield* Effect.fail(new ConcordError('PreviewGitFailed', result.error ?? `Git ${args[0]} failed; verify refs and complete local objects.`));
        return Buffer.concat(chunks);
      }),
    });
  }));
}
export const runGit = Effect.fn('Git.run')((root: string, args: readonly string[], allowFailure: boolean | readonly number[] = false) => Effect.flatMap(Git, git => git.run(root, args, allowFailure)));
export const previewGit = Effect.fn('Git.preview')((cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv, limit = OUTPUT_LIMIT, input?: string) => Effect.flatMap(Git, git => git.preview(cwd, args, environment, limit, input)));
