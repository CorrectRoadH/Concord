// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
import { Effect, Fiber, FiberSet, type Scope, Stream } from 'effect';
import { workspaceEvents, type WorkspaceEvent } from './state.ts';

export const makeHttpSubscriptions = Effect.fn('makeHttpSubscriptions')(function*(
  events: Stream.Stream<WorkspaceEvent>,
  connect: Effect.Effect<unknown, never, Scope.Scope>,
) {
  const fibers = yield* FiberSet.make();
  const run = yield* FiberSet.runtime(fibers)();
  const subscribe = (listener: (event: WorkspaceEvent) => void | Promise<void>) => {
    const fiber = run(Effect.scoped(connect.pipe(Effect.andThen(Stream.runForEach(
      workspaceEvents(events).pipe(Stream.takeUntil(event => event.state === 'stopping')),
      event => Effect.promise(() => Promise.resolve(listener(event))),
    )))));
    return () => { Effect.runFork(Fiber.interrupt(fiber)); };
  };
  return { fibers, subscribe };
});
