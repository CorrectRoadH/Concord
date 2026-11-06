// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Context, type Effect } from 'effect';
import type { RemoteFeedback } from '../../model/index.ts';

/** Optional owner submission port. Source publication has already finished. */
export class FeedbackCacheWriter extends Context.Service<FeedbackCacheWriter, {
  readonly merge: (root: string, connectionId: string, items: readonly RemoteFeedback[]) => Effect.Effect<readonly string[], unknown>;
}>()('concord/base/cache/FeedbackCacheWriter') {}
