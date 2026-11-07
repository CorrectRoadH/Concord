// @concord-file
// @concord-implements docs/engineering/code/architecture.md#publication-views
import { Context, type Effect } from 'effect';
import type { ConcordError } from '../../model/index.ts';
import type { TraceLease } from '../publication/index.ts';

/** Base-private control of the current snapshot; never a domain capability. */
export class SourcePublication extends Context.Service<SourcePublication, {
  readonly withLease: <A, E, R>(lease: TraceLease, operation: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ConcordError, R>;
  readonly verify: Effect.Effect<void, ConcordError>;
  readonly seal: Effect.Effect<void, ConcordError>;
}>()('concord/base/sources/SourcePublication') {}
