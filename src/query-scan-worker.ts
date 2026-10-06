// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { LocalRepository } from './storage.js';
import { Query } from './query-cache.js';
import { scanQueryValue } from './trace.js';
import { stripQueryBodies } from './query-values.js';
import { decodeQueryScanMessage } from './query-scan-protocol.js';
import { ConcordError } from './shared.js';

const main = Effect.gen(function*() {
  const scannedAt = Date.now();
  const message = yield* Effect.sync(() => {
    try {
      const query = Schema.decodeUnknownSync(Query, { onExcessProperty: 'error' })(JSON.parse(process.argv[3] ?? 'null'));
      const repo = new LocalRepository(process.argv[2], { access: 'read', optimistic: true, dryRun: true });
      try {
        const observed = repo.observeProjection(() => scanQueryValue(repo, query));
        return decodeQueryScanMessage({ format: 'concord.query-scan/v1', ok: true, scannedAt, finishedAt: Date.now(),
          value: stripQueryBodies(observed.value.value), complete: observed.value.complete, unknown: observed.value.unknown,
          drift: { ...observed.drift, files: [...new Set([...observed.drift.files, ...observed.value.files])].sort() } });
      } finally { repo.close(); }
    } catch (cause) {
      const error = cause instanceof ConcordError ? cause : new ConcordError('QueryScanFailed', cause instanceof Error ? cause.message : String(cause));
      const details = Schema.decodeUnknownExit(Schema.Json)(error.details);
      return decodeQueryScanMessage({ format: 'concord.query-scan/v1', ok: false, scannedAt, code: error.code, message: error.message,
        ...(details._tag === 'Success' ? { details: details.value } : {}) });
    }
  });
  yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(message)}\n`));
});
NodeRuntime.runMain(main);
