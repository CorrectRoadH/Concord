// @concord-file
// @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { waitForPublication, withSourceSnapshot } from "../../app/index.js";
import { cachedQuery, type Query } from "../../app/index.js";
import { Effect, Option, Result } from "effect";
import { ConcordError } from '../../model/index.js';
import { type LocalRepository, openWriteRepository, openReadRepository } from "../../app/index.js";

import { root, emit, sync } from "./cli-base.js";
import { Queries, type QueryRequest } from '../../app/index.js';

export const withQuery = (request: QueryRequest) => Effect.gen(function*() {
  const settings = yield* root;
  const queries = yield* Queries;
  const reply = yield* queries.execute(Option.getOrUndefined(settings.root), request, settings.dryRun ? 'off' : 'use');
  yield* Effect.sync(() => { if (reply.exitCode !== 0) process.exitCode = reply.exitCode; emit(reply.value, settings.json); });
  return reply.value;
});

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
    if (query !== undefined && settings.fresh && !settings.dryRun) {
      const request: QueryRequest = query[0] === 'trace'
        ? query[1] === 'show' ? { name: 'trace.show', input: { reference: query[2] } } : { name: 'trace.gaps', input: {} }
        : { name: 'review', input: { reference: query[1] } };
      return yield* withQuery(request);
    }
    if (query !== undefined && !settings.fresh && !settings.dryRun) {
      return yield* withQuery({ name: 'historical', input: { query } });
    }
    for (let attempt = 1; ; attempt++) {
      const result = yield* Effect.result(withRepo(operation, { readonly: true }));
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure;
      if (attempt >= 3 || !(error instanceof ConcordError) || !(error.code === 'SourceChanged' || error.code === 'FileChangedSinceRead' && error.details === 'source-observation')) return yield* Effect.fail(error);
      yield* Effect.sleep('50 millis');
    }
  });
}

export { withRepo, withReadRepo };
