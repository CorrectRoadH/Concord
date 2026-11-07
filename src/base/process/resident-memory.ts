// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#编辑器计算
import { readFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { OwnedProcessError } from './owned-process-error.ts';
import { NodeServices } from '@effect/platform-node';

const Kibibytes = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));

/** External observation keeps working while the bounded worker's event loop is busy. */
export const residentMemory = (pid: number): Effect.Effect<number | undefined, OwnedProcessError> => {
  const text: Effect.Effect<string | undefined, unknown, ChildProcessSpawner.ChildProcessSpawner> = process.platform === 'linux' ? Effect.try({
    try: () => {
      try { return /^VmRSS:\s+(\d+)\s+kB$/mu.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]; }
      catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ESRCH') return undefined;
        throw cause;
      }
    }, catch: cause => cause,
  }) : Effect.flatMap(ChildProcessSpawner.ChildProcessSpawner, spawner => spawner.string(ChildProcess.make('/bin/ps', ['-o', 'rss=', '-p', String(pid)])));
  return text.pipe(Effect.flatMap(value => value === undefined || value.trim() === '' ? Effect.succeed(undefined) : Effect.try({
    try: () => Schema.decodeUnknownSync(Kibibytes)(Number(value.trim())) * 1024, catch: cause => cause,
  })), Effect.timeout('5 seconds'), Effect.mapError(cause => new OwnedProcessError({ operation: 'observe', detail: `Cannot observe editor memory: ${String(cause)}` })), Effect.provide(NodeServices.layer));
};
