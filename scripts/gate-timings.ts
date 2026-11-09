// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import { Effect, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const FileTiming = Schema.Struct({
  file: Schema.String, duration_ms: Milliseconds, success: Schema.Boolean,
  cases: Schema.optional(Schema.Number),
  metric: Schema.optional(Schema.Literal('node-file-elapsed-sum')),
});
export type FileTiming = typeof FileTiming.Type;
export const Measurement = Schema.Struct({
  metric: Schema.String,
  state: Schema.Literals(['known', 'unknown', 'not-selected']),
  duration_ms: Schema.NullOr(Milliseconds),
  observed_duration_ms: Milliseconds,
  expected: Schema.Number,
  measured: Schema.Number,
});
export type Measurement = typeof Measurement.Type;

/** Preserve partial observations without presenting failed or missing work as complete. */
export function timingMeasurement(metric: string, observations: readonly { duration_ms: number; success: boolean }[], expected: number, complete = true): Measurement {
  const observed = observations.reduce((sum, row) => sum + row.duration_ms, 0);
  const known = complete && observations.length === expected && observations.every(row => row.success);
  return { metric, state: expected === 0 ? 'not-selected' : known ? 'known' : 'unknown',
    duration_ms: expected === 0 ? null : known ? observed : null,
    observed_duration_ms: observed, expected, measured: observations.length };
}

/** File elapsed and attempt sums have separate owners; neither measures wallclock. */
export function summarizeFileTimings(files: readonly string[], timings: readonly FileTiming[], metric: 'node-file-elapsed-sum', successful = true, root = process.cwd()): Measurement {
  const selected = new Set(files.map(file => resolve(root, file)));
  const measured = new Map(timings.filter(row => selected.has(resolve(root, row.file))).map(row => [resolve(root, row.file), row]));
  return timingMeasurement(metric, [...measured.values()], selected.size,
    successful && [...measured.values()].every(row => (row.metric === undefined || row.metric === metric)));
}

export const readFileTimings = Effect.fn('gate.timings.readFiles')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(path))
    ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(FileTiming)), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : [];
}, Effect.catch(() => Effect.succeed<FileTiming[]>([])));

export const writeTimingReport = Effect.fn('gate.timings.write')(function*(output: string, filename: string, report: unknown) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(output, { recursive: true });
  const path = join(output, filename);
  const temporary = `${path}.${randomUUID()}.tmp`;
  yield* fs.writeFileString(temporary, `${JSON.stringify(report, null, 2)}\n`);
  yield* fs.rename(temporary, path);
});

export const TestTimingReport = Schema.Struct({
  selection: Schema.Struct({ files: Schema.Array(Schema.String), nodeFiles: Schema.Array(Schema.String),
    namePattern: Schema.NullOr(Schema.String), shard: Schema.NullOr(Schema.String) }),
  concurrency: Schema.Struct({ node: Schema.Number }),
  memory: Schema.Struct({ processTreeReports: Schema.Array(Schema.String) }),
  node: Measurement,
  phases: Schema.Array(Schema.Struct({ name: Schema.String, ...Measurement.fields })),
  wallclock: Measurement,
});
export const readTestTimingReport = Effect.fn('gate.timings.readTests')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(output, 'test-timings.json');
  return (yield* fs.exists(path)) ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TestTimingReport), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : null;
}, Effect.catch(() => Effect.succeed(null)));
