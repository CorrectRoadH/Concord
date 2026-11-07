// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { readdirSync, readFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { OwnedProcessError } from './owned-process-error.ts';

const Counter = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const counter = (text: string | undefined) => Schema.decodeUnknownSync(Counter)(text === undefined ? undefined : Number(text));
export type ProcessGroupCpu = ReadonlyMap<string, number>;

// Effect has no process-group CPU observation API. Read kernel counters externally:
// a synchronous worker cannot answer an event-loop heartbeat while making progress.
// No descriptors survive a sample; disappearing tasks are normal, other errors fail.
export const makeProcessGroupCpuReader = Effect.fn('ProcessGroupCpu.makeReader')(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return (groupId: number): Effect.Effect<ProcessGroupCpu, OwnedProcessError> => {
    const read = process.platform === 'linux' ? Effect.try({ try: () => {
      const result = new Map<string, number>();
      for (const pid of readdirSync('/proc').filter(name => /^\d+$/u.test(name))) {
        try {
          const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
          const fields = text.slice(text.lastIndexOf(')') + 1).trim().split(/\s+/u);
          if (counter(fields[2]) === groupId) result.set(`${pid}:${counter(fields[19])}`, counter(fields[11]) + counter(fields[12]));
        } catch (cause) {
          const code = (cause as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'ESRCH') throw cause;
        }
      }
      return result;
    }, catch: cause => cause }) : spawner.string(ChildProcess.make('/bin/ps', ['-axo', 'pid=,pgid=,time='])).pipe(Effect.flatMap(text => Effect.try({ try: () => {
      const result = new Map<string, number>();
      for (const line of text.trim().split('\n')) {
        const fields = line.trim().split(/\s+/u);
        if (counter(fields[1]) !== groupId) continue;
        const time = Schema.decodeUnknownSync(Schema.String)(fields[2]);
        const parts = time.split(':');
        const seconds = parts.reduce((sum, part) => sum * 60 + counter(part), 0);
        result.set(String(counter(fields[0])), seconds);
      }
      return result;
    }, catch: cause => cause })));
    return read.pipe(Effect.timeout('5 seconds'), Effect.mapError(cause => new OwnedProcessError({ operation: 'observe', detail: String(cause) })));
  };
});
