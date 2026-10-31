import { launchDetachedWorker } from '../base/process/index.js';
import { Effect, Result } from "effect";
import { HawdbFailure } from "../base/cache/index.js";
import { queryContext, storeQuery, type QueryContext, type QueryUpdate } from "./query-cache.js";
import { failure } from "../model/index.js";
import { workerEntryArgv } from "../base/installation/index.js";


// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export const requestNewIdentity = Effect.fn('requestNewQueryIdentity')(function*(context: QueryContext) {
  yield* launchDetachedWorker('query-refresh-worker', [context.root, JSON.stringify(context.query), String(Date.now())], context.root);
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
