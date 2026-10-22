// @concord-file
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
import { Effect } from 'effect';
import { Command } from 'effect/unstable/cli';
import { deliverTerminal, jsonOption } from './cli-support.js';
import { REPOSITORY_ENGINE_BYTES, RepositoryEngineRequestInvalid, repositoryEngine, repositoryEngineFailure } from './engine.js';

const readEngineInput = Effect.callback<string, RepositoryEngineRequestInvalid>((resume) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let finished = false;
  const cleanup = () => {
    process.stdin.off('data', onData);
    process.stdin.off('end', onEnd);
    process.stdin.off('error', onError);
    process.stdin.pause();
  };
  const fail = (message: string) => {
    if (finished) return;
    finished = true;
    cleanup();
    resume(Effect.fail(new RepositoryEngineRequestInvalid({ message })));
  };
  const onData = (chunk: Buffer | string) => {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += buffer.byteLength;
    if (bytes > REPOSITORY_ENGINE_BYTES) { fail('Engine request exceeds 32 MiB'); return; }
    chunks.push(buffer);
  };
  const onEnd = () => {
    if (finished) return;
    finished = true;
    cleanup();
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      resume(Effect.succeed(source));
    } catch { resume(Effect.fail(new RepositoryEngineRequestInvalid({ message: 'Engine request must be UTF-8' }))); }
  };
  const onError = () => fail('Unable to read engine request');
  process.stdin.on('data', onData);
  process.stdin.once('end', onEnd);
  process.stdin.once('error', onError);
  return Effect.sync(cleanup);
});

export function makeEngineCommand(root: string) {
  return Command.make('engine', { json: jsonOption }, ({ json }) => Effect.gen(function*() {
    if (!json) return yield* new RepositoryEngineRequestInvalid({ message: 'Engine requires --json' });
    const source = yield* readEngineInput;
    const response = yield* repositoryEngine(root, source);
    yield* deliverTerminal({ stdout: `${response}\n`, stderr: '', exitCode: 0 });
  }).pipe(Effect.catch(cause => deliverTerminal({ stdout: '', stderr: `${JSON.stringify(repositoryEngineFailure(cause))}\n`, exitCode: 1 }))));
}
