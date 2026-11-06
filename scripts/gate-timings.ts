// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const FileTiming = Schema.Struct({
  file: Schema.String, duration_ms: Milliseconds, success: Schema.Boolean,
  cases: Schema.optional(Schema.Number),
  metric: Schema.optional(Schema.Literals(['node-file-elapsed-sum', 'browser-attempt-sum'])),
  unknownAttempts: Schema.optional(Schema.Number),
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
export function summarizeFileTimings(files: readonly string[], timings: readonly FileTiming[], metric: 'node-file-elapsed-sum' | 'browser-attempt-sum', successful = true, root = process.cwd()): Measurement {
  const selected = new Set(files.map(file => resolve(root, file)));
  const measured = new Map(timings.filter(row => selected.has(resolve(root, row.file))).map(row => [resolve(root, row.file), row]));
  return timingMeasurement(metric, [...measured.values()], selected.size,
    successful && [...measured.values()].every(row => (row.metric === undefined || row.metric === metric) && (row.unknownAttempts ?? 0) === 0));
}

export const readFileTimings = Effect.fn('gate.timings.readFiles')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(path))
    ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(FileTiming)), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : [];
}, Effect.catch(() => Effect.succeed<FileTiming[]>([])));

export const readBrowserSelection = Effect.fn('gate.timings.readBrowserSelection')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(output, 'selected-files.json');
  return (yield* fs.exists(path))
    ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : null;
}, Effect.catch(() => Effect.succeed(null)));

export const writeTimingReport = Effect.fn('gate.timings.write')(function*(output: string, filename: string, report: unknown) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(output, { recursive: true });
  const path = join(output, filename);
  const temporary = `${path}.${randomUUID()}.tmp`;
  yield* fs.writeFileString(temporary, `${JSON.stringify(report, null, 2)}\n`);
  yield* fs.rename(temporary, path);
});

export const browserLifecyclePhases = ['worker-start', 'worker-stop', 'fixture-start', 'fixture-stop', 'browser-start', 'browser-stop'] as const;
const LifecycleTiming = Schema.Struct({
  id: Schema.String, worker: Schema.Number, pid: Schema.Number, workerID: Schema.NullOr(Schema.String), phase: Schema.Literals(browserLifecyclePhases),
  startedAt: Milliseconds, endedAt: Schema.NullOr(Milliseconds),
  state: Schema.Literals(['started', 'finished']), duration_ms: Milliseconds, success: Schema.Boolean,
});
export type LifecycleTiming = typeof LifecycleTiming.Type;

/** Start receipts survive interrupted workers. Nested fixture and worker spans overlap. */
export async function recordBrowserTiming<A>(phase: typeof browserLifecyclePhases[number], operation: () => Promise<A>, workerID?: string): Promise<A> {
  const output = process.env.CONCORD_E2E_OUTPUT;
  if (output === undefined) return operation();
  const id = randomUUID();
  const started = performance.now();
  const receipt: LifecycleTiming = { id, worker: process.pid, pid: process.pid, workerID: workerID ?? null,
    phase, startedAt: Date.now(), endedAt: null, state: 'started', duration_ms: 0, success: false };
  const persist = (value: LifecycleTiming) => Effect.runPromise(writeTimingReport(join(output, 'lifecycle-timings'), `${id}.json`, value).pipe(
    // Diagnostics must not replace an operation's original rejection or cancellation.
    Effect.catchCause(() => Effect.void), Effect.provide(NodeServices.layer),
  ));
  await persist(receipt);
  let success = false;
  try {
    const value = await operation();
    success = true;
    return value;
  } finally {
    await persist({ ...receipt, state: 'finished', endedAt: Date.now(), duration_ms: performance.now() - started, success });
  }
}

export const readBrowserLifecycle = Effect.fn('gate.timings.readBrowserLifecycle')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  const directory = join(output, 'lifecycle-timings');
  if (!(yield* fs.exists(directory))) return [];
  const files = yield* fs.readDirectory(directory);
  return yield* Effect.forEach(files.filter(file => file.endsWith('.json')), file => Effect.gen(function*() {
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(LifecycleTiming), { onExcessProperty: 'error' })(yield* fs.readFileString(join(directory, file)));
  }));
}, Effect.catch(() => Effect.succeed<LifecycleTiming[]>([])));

export function summarizeBrowserLifecycle(rows: readonly LifecycleTiming[], selected: boolean, successful = true) {
  return browserLifecyclePhases.map(phase => {
    const family = phase.slice(0, phase.lastIndexOf('-'));
    const leases = new Map<string, { starts: number; stops: number }>();
    for (const row of rows.filter(row => row.phase.startsWith(`${family}-`))) {
      // Browser preparation and worker execution may live in sibling processes.
      const identity = row.workerID ?? `unknown-worker:${row.pid}`;
      const count = leases.get(identity) ?? { starts: 0, stops: 0 };
      if (row.phase.endsWith('-start')) count.starts++;
      else count.stops++;
      leases.set(identity, count);
    }
    // Each started receipt owns a span; replacement leases can reuse a slot.
    const expected = [...leases.values()].reduce((sum, lease) => sum + Math.max(lease.starts, lease.stops), 0);
    const measured = rows.filter(row => row.phase === phase && row.state === 'finished');
    return { phase, ...timingMeasurement(`${phase}-elapsed-sum`, measured, selected ? Math.max(1, expected) : 0, successful) };
  });
}

export const TestTimingReport = Schema.Struct({
  selection: Schema.Struct({ files: Schema.Array(Schema.String), nodeFiles: Schema.Array(Schema.String), browserFiles: Schema.Array(Schema.String), requestedBrowserFiles: Schema.Array(Schema.String),
    suite: Schema.String, namePattern: Schema.NullOr(Schema.String), shard: Schema.NullOr(Schema.String) }),
  concurrency: Schema.Struct({ node: Schema.Number, browser: Schema.Number, packaging: Schema.Literal(1) }),
  node: Measurement, browser: Measurement,
  browserLifecycle: Schema.Array(Schema.Struct({ phase: Schema.Literals(browserLifecyclePhases), ...Measurement.fields })),
  phases: Schema.Array(Schema.Struct({ name: Schema.String, ...Measurement.fields })),
  wallclock: Measurement,
});
export const readTestTimingReport = Effect.fn('gate.timings.readTests')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(output, 'test-timings.json');
  return (yield* fs.exists(path)) ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TestTimingReport), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : null;
}, Effect.catch(() => Effect.succeed(null)));
