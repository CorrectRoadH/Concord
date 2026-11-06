import { Effect } from 'effect';
import { processEventEnvironment, recordProcessSpawn } from './process-events.ts';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { failure } from '../../model/index.ts';
import { workerEntryArgv } from '../installation/index.ts';

/** Explicit transfer to an independent worker; ordinary children stay scoped. */
export const launchDetachedWorker = Effect.fn('OwnedProcess.launchWorker')(function*(worker: Parameters<typeof workerEntryArgv>[0], args: readonly string[], cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* Effect.scoped(Effect.gen(function*() {
    const command = [process.execPath, ...workerEntryArgv(worker), ...args];
    const env = processEventEnvironment(command);
    const child = yield* spawner.spawn(ChildProcess.make(process.execPath, command.slice(1), {
      env,
      cwd, detached: true, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', forceKillAfter: 500,
    }));
    recordProcessSpawn(command, env, Number(child.pid));
    yield* child.unref;
  })).pipe(Effect.mapError(failure));
});
