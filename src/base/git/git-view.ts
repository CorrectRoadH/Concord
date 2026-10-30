// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/review-local-changes.md

import { execFile } from "node:child_process";


import { Effect } from "effect";


import { ConcordError } from "../../model/index.js";


export const OUTPUT_LIMIT = 2 * 1024 * 1024;
export const runGit = Effect.fn('view.runGit')(function*(root: string, args: readonly string[], allowFailure: boolean | readonly number[] = false) {
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
