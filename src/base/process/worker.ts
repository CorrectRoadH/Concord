import { Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { failure } from '../../model/index.ts';
import { workerEntryArgv } from '../installation/index.ts';

/** Explicit transfer to an independent worker; ordinary children stay scoped. */
export const launchDetachedWorker = Effect.fn('OwnedProcess.launchWorker')(function*(worker: Parameters<typeof workerEntryArgv>[0], args: readonly string[], cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* Effect.scoped(Effect.gen(function*() {
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [...workerEntryArgv(worker), ...args], {
      cwd, detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', forceKillAfter: 500,
    }));
    yield* child.unref;
  })).pipe(Effect.mapError(failure));
});
