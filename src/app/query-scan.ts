// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md

import { Clock, Effect, Schema } from "effect";
import { openReadRepository } from "../base/workspace/index.js";
import { Query } from "./query-cache.js";
import { scanQueryValue } from "./trace-queries.js";
import { stripQueryBodies } from "../model/index.js";
import { decodeQueryScanMessage } from "../model/index.js";
import { ConcordError } from "../model/index.js";

export const scanQueryProcess = Effect.fn('query.scanProcess')(function*(root: string | undefined, rawQuery: string | undefined) {
  const scannedAt = Date.now();
  return yield* Effect.gen(function*() {
      const query = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Query, { onExcessProperty: 'error' })(JSON.parse(rawQuery ?? 'null')), catch: cause => cause });
      const repo = yield* openReadRepository(root, { access: 'read', optimistic: true, dryRun: true });
      return yield* Effect.try({ try: () => {
        const observed = repo.observeProjection(() => scanQueryValue(repo, query));
        return decodeQueryScanMessage({ format: 'concord.query-scan/v1', ok: true, scannedAt, finishedAt: Date.now(),
          value: stripQueryBodies(observed.value.value), complete: observed.value.complete, unknown: observed.value.unknown,
          drift: { ...observed.drift, files: [...new Set([...observed.drift.files, ...observed.value.files])].sort() } });
      }, catch: cause => cause });
  }).pipe(Effect.scoped, Effect.catch(cause => Effect.sync(() => {
      const error = cause instanceof ConcordError ? cause : new ConcordError('QueryScanFailed', cause instanceof Error ? cause.message : String(cause));
      const details = Schema.decodeUnknownExit(Schema.Json)(error.details);
      return decodeQueryScanMessage({ format: 'concord.query-scan/v1', ok: false, scannedAt, code: error.code, message: error.message,
        ...(details._tag === 'Success' ? { details: details.value } : {}) });
  })));
});
