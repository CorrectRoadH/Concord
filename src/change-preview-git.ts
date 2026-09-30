import { spawn, type ChildProcess } from 'node:child_process';
import { Effect } from 'effect';
import { ConcordError } from './shared.js';

export function previewGitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) if (name.startsWith('GIT_')) delete environment[name];
  return { ...environment, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_ATTR_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}
function signal(child: ChildProcess, value: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try { if (process.platform === 'win32') child.kill(value); else process.kill(-child.pid, value); } catch { /* already terminated */ }
}
/** Each process is closed before its scope ends, including timeout and interruption. */
export const previewGit = Effect.fn('preview.git')(function*(cwd: string, args: readonly string[], environment: NodeJS.ProcessEnv, limit = 2 * 1024 * 1024, input?: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const owned = yield* Effect.acquireRelease(Effect.try({
      try: () => {
        const child = spawn('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), ...args], {
          cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
        });
        let complete = false, failure: ConcordError | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
        const stop = () => { signal(child, 'SIGTERM'); killTimer ??= setTimeout(() => signal(child, 'SIGKILL'), 250); };
        const chunks: Buffer[] = []; let outputBytes = 0, errorBytes = 0;
        let closed!: () => void;
        const closure = new Promise<void>(resolve => { closed = resolve; });
        const result = new Promise<Buffer>((resolve, reject) => {
          const deadline = setTimeout(() => { failure ??= new ConcordError('PreviewGitTimeout', 'Git exceeded its 10 second budget.'); stop(); }, 10000);
          child.stdout.on('data', (chunk: Buffer) => {
            outputBytes += chunk.length;
            if (outputBytes > limit) { failure ??= new ConcordError('PreviewBudgetExceeded', 'Git output exceeds the export budget.'); stop(); }
            else if (!failure) chunks.push(chunk);
          });
          child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 65536) { failure ??= new ConcordError('PreviewBudgetExceeded', 'Git stderr exceeds 64 KiB.'); stop(); } });
          child.on('error', error => { failure ??= new ConcordError('PreviewGitFailed', error.message); });
          child.stdin.on('error', () => { /* process failure is reported after close */ });
          child.once('close', code => {
            complete = true; clearTimeout(deadline); if (killTimer) clearTimeout(killTimer); closed();
            if (failure) reject(failure);
            else if (code !== 0) reject(new ConcordError('PreviewGitFailed', `Git ${args[0]} failed; verify refs and complete local objects.`));
            else resolve(Buffer.concat(chunks));
          });
          child.stdin.end(input);
        });
        void result.catch(() => undefined);
        return { result, release: async () => { if (!complete) stop(); await closure; } };
      }, catch: cause => cause instanceof ConcordError ? cause : new ConcordError('PreviewGitFailed', String(cause)),
    }), owned => Effect.promise(owned.release));
    return yield* Effect.tryPromise({ try: () => owned.result, catch: cause => cause instanceof ConcordError ? cause : new ConcordError('PreviewGitFailed', String(cause)) });
  }));
});
