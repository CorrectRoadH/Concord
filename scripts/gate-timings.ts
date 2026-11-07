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
  concurrency: Schema.Struct({ node: Schema.Number, browser: Schema.Number }),
  admission: Schema.optional(Schema.Struct({
    capacityBytes: Schema.Number,
    budgets: Schema.Struct({ fixed: Schema.Number, browser: Schema.Number, node: Schema.Number }),
    nodeConcurrencyIsUpperLimit: Schema.Boolean, browserReservation: Schema.String,
    processTreeReports: Schema.Array(Schema.String),
    timings: Schema.optional(Schema.Array(Schema.Struct({ category: Schema.String, bytes: Schema.Number, wait_ms: Schema.Number, run_ms: Schema.Number }))),
  })),
  node: Measurement, browser: Measurement,
  browserLifecycle: Schema.Array(Schema.Struct({ phase: Schema.Literals(browserLifecyclePhases), ...Measurement.fields })),
  phases: Schema.Array(Schema.Struct({ name: Schema.String, ...Measurement.fields })),
  wallclock: Measurement,
});
export const readTestTimingReport = Effect.fn('gate.timings.readTests')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* writeBrowserCostReport(join(output, 'e2e'));
  const path = join(output, 'test-timings.json');
  return (yield* fs.exists(path)) ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(TestTimingReport), { onExcessProperty: 'error' })(yield* fs.readFileString(path)) : null;
}, Effect.catch(() => Effect.succeed(null)));

export const browserCostPhases = ['frozen-files', 'restore-refresh', 'frozen-verification', 'setup-refresh', 'private-server-start', 'engine-start', 'case-execution', 'engine-stop', 'private-cleanup'] as const;
const BrowserCostSpan = Schema.Struct({
  phase: Schema.Literals(browserCostPhases), started_ms: Milliseconds, ended_ms: Schema.NullOr(Milliseconds), success: Schema.Boolean,
});
export const BrowserAttemptCost = Schema.Struct({
  attemptId: Schema.String, artifactsDir: Schema.String, workerID: Schema.NullOr(Schema.String), pid: Schema.Number,
  state: Schema.Literals(['started', 'finished']), spans: Schema.Array(BrowserCostSpan),
});
export type BrowserAttemptCost = typeof BrowserAttemptCost.Type;

/** Buffer monotonic spans; only attempt boundaries write diagnostics, never individual requests. */
export class BrowserAttemptTimer {
  static current: BrowserAttemptTimer | undefined;
  readonly receipt: { -readonly [K in keyof BrowserAttemptCost]: K extends 'spans' ? Array<typeof BrowserCostSpan.Type> : BrowserAttemptCost[K] };
  private readonly origin = performance.now();
  constructor(attemptId: string, artifactsDir: string, workerID?: string) {
    this.receipt = { attemptId, artifactsDir, workerID: workerID ?? null, pid: process.pid, state: 'started', spans: [] };
  }
  begin(phase: typeof browserCostPhases[number]): (success: boolean) => void {
    const span = { phase, started_ms: performance.now() - this.origin, ended_ms: null as number | null, success: false };
    this.receipt.spans.push(span);
    return success => { span.ended_ms = performance.now() - this.origin; span.success = success; };
  }
  sync<A>(phase: typeof browserCostPhases[number], operation: () => A): A {
    const end = this.begin(phase);
    let success = false;
    try { const value = operation(); success = true; return value; }
    finally { end(success); }
  }
  async measure<A>(phase: typeof browserCostPhases[number], operation: () => Promise<A>): Promise<A> {
    const end = this.begin(phase);
    let success = false;
    try { const value = await operation(); success = true; return value; }
    finally { end(success); }
  }
  async persist(finished = false): Promise<void> {
    const output = process.env.CONCORD_E2E_OUTPUT;
    if (output === undefined) return;
    if (finished) this.receipt.state = 'finished';
    await Effect.runPromise(writeTimingReport(join(output, 'attempt-costs'), `${this.receipt.attemptId}.json`, this.receipt).pipe(
      Effect.catchCause(() => Effect.void), Effect.provide(NodeServices.layer),
    ));
  }
}

// Explicitly retain the official report's other fields while validating the identity/timing projection.
const OfficialAttempt = Schema.StructWithRest(Schema.Struct({ id: Schema.String, durationMs: Milliseconds, status: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]);
const OfficialCostResult = Schema.StructWithRest(Schema.Struct({
  testId: Schema.String, titlePath: Schema.Array(Schema.String), file: Schema.String, kind: Schema.String,
  selected: Schema.Boolean, status: Schema.String, attempts: Schema.Array(OfficialAttempt),
}), [Schema.Record(Schema.String, Schema.Unknown)]);
const OfficialCostReport = Schema.StructWithRest(Schema.Struct({
  run: Schema.StructWithRest(Schema.Struct({ results: Schema.Array(OfficialCostResult) }), [Schema.Record(Schema.String, Schema.Unknown)]),
}), [Schema.Record(Schema.String, Schema.Unknown)]);

/** The engine exposes attemptId, not testId/title/file: join only exact official attempt IDs. */
export function summarizeBrowserCosts(results: readonly typeof OfficialCostResult.Type[], receipts: readonly BrowserAttemptCost[]) {
  return results.filter(result => result.selected && result.kind === 'test').flatMap(result => {
    const attempts = result.attempts.length ? result.attempts : [null];
    return attempts.map(attempt => {
      const matches = receipts.filter(row => row.attemptId === attempt?.id);
      const receipt = matches.length === 1 ? matches[0] : undefined;
      const complete = receipt?.state === 'finished' && attempt?.status === 'passed';
      const phases = browserCostPhases.map(phase => {
        const spans = receipt?.spans.filter(span => span.phase === phase) ?? [];
        const observations = spans.flatMap(span => span.ended_ms === null ? [] : [{ duration_ms: span.ended_ms - span.started_ms, success: span.success }]);
        // Optional phases are known absent only in a complete instrumented attempt.
        const required = ['frozen-files', 'restore-refresh', 'frozen-verification', 'engine-start', 'case-execution', 'engine-stop', 'private-cleanup'].includes(phase);
        const measurement = timingMeasurement(`${phase}-elapsed-sum`, observations, Math.max(required || !complete ? 1 : 0, spans.length), complete);
        return { phase, ...measurement };
      });
      // Subtract the union of nested fixture work, so overlapping spans are removed once.
      const execution = receipt?.spans.find(span => span.phase === 'case-execution');
      const nested = execution?.ended_ms === null || execution === undefined ? [] : (receipt?.spans ?? [])
        .filter(span => span.phase === 'setup-refresh' || span.phase === 'private-server-start')
        .flatMap(span => span.ended_ms === null ? [] : [[Math.max(execution.started_ms, span.started_ms), Math.min(execution.ended_ms!, span.ended_ms)] as const])
        .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
      let removed = 0;
      let previousEnd = execution?.started_ms ?? 0;
      for (const [start, end] of nested) {
        removed += Math.max(0, end - Math.max(start, previousEnd));
        previousEnd = Math.max(previousEnd, end);
      }
      const executionExclusive = timingMeasurement('case-execution-without-fixture-waits', execution?.ended_ms === null || execution === undefined ? [] : [{
        duration_ms: Math.max(0, execution.ended_ms - execution.started_ms - removed), success: execution.success,
      }], 1, complete && (receipt?.spans.every(span => span.ended_ms !== null && span.success) ?? false));
      return { testId: result.testId, titlePath: result.titlePath, file: result.file, attemptId: attempt?.id ?? null,
        status: attempt?.status ?? result.status, workerID: receipt?.workerID ?? null,
        attempt: timingMeasurement('official-browser-attempt', attempt ? [{ duration_ms: attempt.durationMs, success: attempt.status === 'passed' }] : [], 1),
        phases, executionExclusive, spans: receipt?.spans ?? [], receiptState: receipt?.state ?? 'unknown' };
    });
  });
}

/** Called after the suites finish; unavailable reports still emit an explicit unknown receipt. */
export const writeBrowserCostReport = Effect.fn('gate.timings.writeBrowserCosts')(function*(output: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(output))) return;
  const reportPath = join(output, 'report.json');
  const report = (yield* fs.exists(reportPath))
    ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OfficialCostReport), { onExcessProperty: 'error' })(yield* fs.readFileString(reportPath)).pipe(Effect.option) : undefined;
  const directory = join(output, 'attempt-costs');
  const files = (yield* fs.exists(directory)) ? yield* fs.readDirectory(directory) : [];
  const receipts = yield* Effect.forEach(files.filter(file => file.endsWith('.json')), file => Effect.gen(function*() {
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BrowserAttemptCost), { onExcessProperty: 'error' })(yield* fs.readFileString(join(directory, file)));
  }).pipe(Effect.option));
  const valid = receipts.flatMap(row => row._tag === 'Some' ? [row.value] : []);
  const results = report?._tag === 'Some' ? report.value.run.results : null;
  yield* writeTimingReport(output, 'browser-costs.json', {
    state: results === null ? 'unknown' : 'known', report: reportPath,
    notes: ['Phase durations use monotonic time; official attempts include engine preparation and cleanup.',
      'case-execution includes runner fixtures/hooks and test body; setup-refresh and private-server-start nest inside it. Never add nested spans.',
      'executionExclusive removes the union of nested fixture refresh/private-start spans, and still includes runner fixtures/hooks.',
      'Worker startup/fixture startup nest separately and may fall inside the first official attempt; do not add them to attempt sums.',
      'Missing, failed or unfinished phases are unknown; optional uncalled phases in complete receipts are not-selected.'],
    cases: results === null ? [] : summarizeBrowserCosts(results, valid),
    unassociatedReceipts: valid.filter(row => !results?.some(result => result.attempts.some(attempt => attempt.id === row.attemptId))),
    invalidReceipts: receipts.length - valid.length,
  });
}, Effect.catchCause(() => Effect.void));
