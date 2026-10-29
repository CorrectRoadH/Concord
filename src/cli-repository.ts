// @concord-file
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { waitForPublication } from './publication-wait.js';
import { cachedQuery, type Query } from './query-cache.js';
import { Effect, Option } from 'effect';
import { LocalRepository } from './storage.js';
import { failure } from './shared.js';
import { root, emit, sync } from './cli-base.js';

function withRepo<A, E, R>(operation: (repo: LocalRepository, settings: { json: boolean; dryRun: boolean }) => Effect.Effect<A, E, R>, options: { initialize?: boolean; recover?: boolean; readonly?: boolean; unlocked?: boolean } = {}) {
  return Effect.gen(function*() {
    const settings = yield* root;
    const repo = yield* Effect.acquireRelease(
      waitForPublication(reclaimDead => Effect.try({ try: () => new LocalRepository(Option.getOrUndefined(settings.root), { optimistic: !options.unlocked, reclaimPublication: reclaimDead, initialize: options.initialize, recover: options.recover, access: options.readonly ? 'read' : 'write', dryRun: options.initialize && options.readonly || settings.dryRun }), catch: failure })),
      repo => Effect.sync(() => repo.close()),
    );
    if (!options.unlocked) yield* Effect.acquireRelease(waitForPublication(reclaimDead => sync(() => repo.beginSnapshot(reclaimDead))), () => Effect.sync(() => repo.endSnapshot()));
    return yield* operation(repo, settings).pipe(Effect.tap(() => sync(() => repo.verifySnapshot())), Effect.tap(result => Effect.sync(() => emit(result, settings.json))));
  }).pipe(Effect.scoped);
}

function withReadRepo<A, E, R>(operation: (repo: LocalRepository, settings: { json: boolean; dryRun: boolean }) => Effect.Effect<A, E, R>, query?: Query) {
  return Effect.gen(function*() {
    const settings = yield* root;
    if (query !== undefined && !settings.fresh && !settings.dryRun) {
      const value = yield* cachedQuery(Option.getOrUndefined(settings.root), query);
      yield* Effect.sync(() => emit(value, settings.json));
      return value;
    }
    return yield* withRepo(operation, { readonly: true });
  });
}

export { withRepo, withReadRepo };
