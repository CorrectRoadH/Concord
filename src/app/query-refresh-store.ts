import { RuntimeEnvironment } from '../base/environment/index.ts';
import { launchDetachedWorker } from '../base/process/index.ts';
import { Effect, Option, Result } from "effect";
import { HawdbFailure } from "../base/cache/index.ts";
import { QueryRefreshRequest, queryContext, storeQuery, type QueryContext, type QueryUpdate } from "./query-cache.ts";
import { failure } from "../model/index.ts";
import { workerEntryArgv } from "../base/installation/index.ts";


// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export const requestNewIdentity = Effect.fn('requestNewQueryIdentity')(function*(context: QueryContext) {
  const requester = yield* Effect.serviceOption(QueryRefreshRequest);
  if (Option.isSome(requester)) return yield* requester.value.request(context);
  yield* launchDetachedWorker('query-refresh-worker', [context.root, JSON.stringify(context.query), String(Date.now())], (yield* RuntimeEnvironment).cwd);
});
// @concord-end
export const persist = Effect.fn('persistQuery')(function*(context: QueryContext, update: QueryUpdate) {
  const deadline = Date.now() + 3000;
  while (true) {
    const current = yield* queryContext(context.root, context.query);
    if (current.key !== context.key) { yield* requestNewIdentity(current); return; }
    const result = yield* Effect.result(storeQuery(context, update));
    if (Result.isSuccess(result)) return;
    if (!(result.failure instanceof HawdbFailure) || !['HawdbBusy', 'UnsafePath'].includes(result.failure.code) || Date.now() >= deadline) return yield* Effect.fail(result.failure);
    yield* Effect.sleep('25 millis');
  }
});
