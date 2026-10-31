// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#状态
import { Clock, Context, Effect, Layer, Schedule, SubscriptionRef } from 'effect';
import type { WorkspaceProjection } from '../../model/index.js';
import type { ServerState } from './protocol.js';

export interface WorkspaceEvent {
  readonly token: string;
  readonly state: ServerState;
  readonly generation: number;
  readonly workspace?: WorkspaceProjection;
  readonly error?: { readonly code: string; readonly message: string };
}
export class WorkspaceState extends Context.Service<WorkspaceState, {
  readonly value: SubscriptionRef.SubscriptionRef<WorkspaceEvent>;
  readonly transition: (state: ServerState, error?: WorkspaceEvent['error']) => Effect.Effect<void>;
  readonly accept: (workspace: WorkspaceProjection) => Effect.Effect<void>;
  readonly touch: Effect.Effect<void>;
  readonly expired: Effect.Effect<boolean>;
}>()('concord/server/WorkspaceState') {
  static layer(token: string) {
    return Layer.effect(WorkspaceState, Effect.gen(function*() {
      const value = yield* SubscriptionRef.make<WorkspaceEvent>({ token, generation: 0, state: 'opening' });
      let lastRequest = yield* Clock.currentTimeMillis;
      return {
        value,
        transition: (state, error) => SubscriptionRef.update(value, prior => ({ ...prior, state, error })),
        accept: workspace => SubscriptionRef.update(value, prior => ({ ...prior, generation: prior.workspace?.projection.builtAt === workspace.projection.builtAt ? prior.generation : prior.generation + 1, workspace })),
        touch: Clock.currentTimeMillis.pipe(Effect.tap(now => Effect.sync(() => { lastRequest = now; })), Effect.asVoid),
        expired: Clock.currentTimeMillis.pipe(Effect.map(now => now - lastRequest >= 600_000)),
      };
    }));
  }
}
export const serviceHeartbeat = Schedule.spaced('5 seconds');
export const compensationRefresh = Schedule.spaced('30 seconds');
