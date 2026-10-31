// @concord-file
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { waitForPublication, withSourceSnapshot } from "../../app/index.js";
import { cachedQuery, type Query } from "../../app/index.js";
import { Effect, Option, Result } from "effect";
import { ConcordError } from '../../model/index.js';
import { type LocalRepository, openWriteRepository, openReadRepository } from "../../app/index.js";

import { root, emit, sync } from "./cli-base.js";

function withRepo<A, E, R>(operation: (repo: LocalRepository, settings: { json: boolean; dryRun: boolean }) => Effect.Effect<A, E, R>, options: { initialize?: boolean; recover?: boolean; readonly?: boolean; unlocked?: boolean } = {}) {
  return Effect.gen(function*() {
    const settings = yield* root;
    const repo = yield* Effect.acquireRelease(
      waitForPublication(reclaimDead => {
        const selected = { optimistic: !options.unlocked, reclaimPublication: reclaimDead, initialize: options.initialize, recover: options.recover, dryRun: options.initialize && options.readonly || settings.dryRun };
        return options.readonly && !options.initialize
          ? openReadRepository(Option.getOrUndefined(settings.root), { ...selected, access: 'read' })
          : openWriteRepository(Option.getOrUndefined(settings.root), { ...selected, access: options.readonly ? 'read' : 'write' });
      }),
      repo => Effect.sync(() => repo.close()),
    );
    const run = operation(repo, settings);
    return yield* (options.unlocked ? run : withSourceSnapshot(repo, run)).pipe(Effect.tap(result => Effect.sync(() => emit(result, settings.json))));
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
    for (let attempt = 1; ; attempt++) {
      const result = yield* Effect.result(withRepo(operation, { readonly: true }));
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure;
      if (attempt >= 3 || !(error instanceof ConcordError) || !(error.code === 'SourceChanged' || error.code === 'PreimageChanged' && error.details === 'source-observation')) return yield* Effect.fail(error);
      yield* Effect.sleep('50 millis');
    }
  });
}

export { withRepo, withReadRepo };
