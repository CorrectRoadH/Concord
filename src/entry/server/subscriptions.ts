// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
// @concord-implements docs/feature/local-data-engine/cli.md#等待下一份结果
import { Duration, Effect, Fiber, FiberSet, Option, Schema, type Scope, Stream } from 'effect';
import type { WorkspaceWait } from '../../model/herdr-mod/index.ts';
import { ConcordError, WorkspaceServerEvent } from '../../model/index.ts';
import { workspaceEvents, type WorkspaceEvent } from './state.ts';

/** Subscribe before inspecting the initial event, closing the read/subscribe race. */
export const waitForWorkspaceResult = Effect.fn('waitForWorkspaceResult')(function*(events: Stream.Stream<unknown, unknown>, after: string | undefined, timeout: number) {
  let latest: string | null = null;
  return yield* events.pipe(
    Stream.mapEffect(value => Schema.decodeUnknownEffect(WorkspaceServerEvent, { onExcessProperty: 'error' })(value)),
    Stream.mapEffect(event => {
      if (event.state === 'stopping') return Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Workspace service stopped while waiting'));
      latest = event.sourceDigest;
      return Effect.succeed(event);
    }),
    Stream.filter(event => event.sourceDigest !== null && event.sourceDigest !== after),
    Stream.runHead,
    Effect.flatMap(event => Option.isSome(event)
      ? Effect.succeed<WorkspaceWait>({ operation: 'workspace-wait', changed: true, sourceDigest: event.value.sourceDigest })
      : Effect.fail(new ConcordError('WorkspaceServerUnavailable', 'Workspace subscription ended while waiting'))),
    Effect.timeoutOrElse({ duration: Duration.seconds(timeout), orElse: () => Effect.succeed<WorkspaceWait>({ operation: 'workspace-wait', changed: false, sourceDigest: latest }) }),
  );
});

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
