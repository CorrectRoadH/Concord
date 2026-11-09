import { NodeRuntime } from '@effect/platform-node';
import { Effect, type Scope } from 'effect';
import { run } from 'mitata';

export type RegisterBenchmarks = (scope: Scope.Scope) => void;

/** Mitata owns sampling. Wait for its current run before closing resources on interruption. */
export const runBenchmarks = (register: RegisterBenchmarks): void => {
  Effect.scoped(Effect.gen(function*() {
    register(yield* Effect.scope);
    yield* Effect.promise(() => run({ throw: true })).pipe(Effect.uninterruptible);
  })).pipe(NodeRuntime.runMain);
};
