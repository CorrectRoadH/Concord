import { spawn } from "node:child_process";
import { Effect, Result } from "effect";
import { HawdbFailure } from "../base/cache/index.js";
import { queryContext, storeQuery, type QueryContext, type QueryUpdate } from "./query-cache.js";
import { failure } from "../model/index.js";
import { workerEntryArgv } from "../base/installation/index.js";


// @concord-begin
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
export const requestNewIdentity = Effect.fn('requestNewQueryIdentity')(function*(context: QueryContext) {
  yield* Effect.tryPromise({ try: () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [...workerEntryArgv('query-refresh-worker'), context.root, JSON.stringify(context.query), String(Date.now())], { detached: true, stdio: 'ignore', cwd: context.root });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  }), catch: failure });
});
// @concord-end
export const persist = Effect.fn('persistQuery')(function*(context: QueryContext, update: QueryUpdate) {
  const deadline = Date.now() + 3000;
  while (true) {
    const current = yield* Effect.try({ try: () => queryContext(context.root, context.query), catch: failure });
    if (current.key !== context.key) { yield* requestNewIdentity(current); return; }
    const result = yield* Effect.result(Effect.try({ try: () => storeQuery(context, update), catch: cause => cause }));
    if (Result.isSuccess(result)) return;
    if (!(result.failure instanceof HawdbFailure) || !['HawdbBusy', 'UnsafePath'].includes(result.failure.code) || Date.now() >= deadline) return yield* Effect.fail(result.failure);
    yield* Effect.sleep('25 millis');
  }
});
