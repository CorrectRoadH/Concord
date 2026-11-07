// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { refreshQuery, Query } from '../../app/index.ts';
import { runRefreshMain } from './main.ts';
import { Effect, Schema } from 'effect';

export function run(): void {
  runRefreshMain(Effect.gen(function*() {
    const query = yield* Schema.decodeUnknownEffect(Query)(JSON.parse(process.argv[3] ?? 'null'));
    const positive = Schema.Number.check(Schema.isGreaterThan(0));
    const requestedAt = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[4]));
    const limitMs = yield* Schema.decodeUnknownEffect(positive)(Number(process.argv[5] ?? 120_000));
    yield* refreshQuery(process.argv[2], query, requestedAt, limitMs);
  }).pipe(Effect.scoped));
}
