// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决
import { Effect } from 'effect';
import type { ConcordError } from '../../model/index.ts';

/** Callers scope each attempt and supply only operations that publish no facts. */
export const retryWorkspaceRead = <A, R>(operation: (retry: boolean) => Effect.Effect<A, ConcordError, R>, enabled: boolean) => Effect.gen(function*() {
  const result = yield* Effect.result(operation(false));
  if (result._tag === 'Success') return result.success;
  if (!enabled || !['WorkspaceServerUnavailable', 'WorkspaceComputeExited'].includes(result.failure.code)) return yield* Effect.fail(result.failure);
  return yield* operation(true);
});
