// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { Effect } from 'effect';
import { ConcordError } from '../../model/index.ts';

/** One pool belongs to the service, across all request transports. */
export function makeRequestAdmission() {
  let pending = 0;
  const reserve = (): (() => void) | undefined => {
    if (pending >= 256) return undefined;
    pending++;
    let released = false;
    return () => { if (!released) { released = true; pending--; } };
  };
  const withSlot = <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.scoped(Effect.acquireRelease(Effect.suspend(() => {
    const release = reserve();
    return release ? Effect.succeed(release) : Effect.fail(new ConcordError('WorkspaceServerBusy', 'The service has 256 unanswered requests'));
  }), release => Effect.sync(release)).pipe(Effect.andThen(operation)));
  return { reserve, withSlot, pending: () => pending };
}
export type RequestAdmission = ReturnType<typeof makeRequestAdmission>;
