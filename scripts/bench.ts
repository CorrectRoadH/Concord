import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { environment, loadArtifact, type Artifact } from './perf/artifact.js';
import { budgetSources, missingOwner, parseBudgetTable, type BudgetRow } from './perf/budgets.js';
import { QueryScanMessage } from '../src/query-scan-protocol.js';
import type { Consumer } from './perf/consumer.js';
import { io, PerfError, timedRun } from './perf/process.js';
import { judge, measurementPass, skippedVerdict, summarize, type GroupStats, type GroupVerdict } from './perf/stats.js';
import { parseScale, prepareConsumer, workDirectory } from './perf/workspace.js';

const usage = 'Usage: pnpm bench <cli|query|view> [--consumer self|scale|<path>] [--commit <rev>] [--scale <sources>,<tests>,<pages>] [--baseline <built-checkout>] [--samples 7] [--reference] [--out <file.json>] [--keep]';
const Samples = Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }));
const Path = Schema.Literals(['cli', 'query', 'view']);
interface Context {
  readonly consumer: Consumer; readonly artifacts: readonly Artifact[]; readonly samples: number;
  readonly reference: boolean; readonly outputDir: string;
}
interface Snapshot { readonly command: string; readonly artifact: string; readonly readyAfterMs?: number; readonly lastError?: string }
const budgets = (source: keyof typeof budgetSources) => io('Read budget owner', () =>
  parseBudgetTable(readFileSync(resolve(budgetSources[source].path), 'utf8'), budgetSources[source].heading));
const run = (context: Context, artifact: Artifact, args: readonly string[], timeoutMs?: number) =>
  timedRun([process.execPath, artifact.entry, ...args], { cwd: context.consumer.root, outputDir: context.outputDir, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
const label = (args: readonly string[]) => `concord ${args.join(' ')}`;
const skip = (context: Context, args: readonly string[]) => io('Check command owners', () => {
  const reason = missingOwner(args, p => existsSync(join(context.consumer.root, p)));
  return reason === undefined ? undefined : skippedVerdict(label(args), context.consumer.kind, reason);
});
const emptyStats: GroupStats = { samples: [], p50: 0, max: 0, valid: false };
const failure = (args: readonly string[], reason: string): GroupVerdict => ({ command: label(args), candidate: emptyStats, pass: false, reasons: [reason] });

/** Warm each artifact independently, then interleave fresh processes; retry one noisy group. */
const measureGroup = Effect.fn('bench.measureGroup')(function*(context: Context, args: readonly string[], timeoutMs?: number, scan = false) {
  const measure = (artifact: Artifact) => scan
    ? timedRun([process.execPath, join(dirname(artifact.entry), 'query-scan-worker.js'), context.consumer.root, JSON.stringify(args.filter(arg => !['--json', '--fresh', '--dry-run'].includes(arg)))], { cwd: context.consumer.root, outputDir: context.outputDir, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    : run(context, artifact, args, timeoutMs);
  const reasons: string[] = [];
  for (const artifact of context.artifacts) {
    const warm = yield* measure(artifact);
    if (warm.exitCode !== 0) reasons.push(`${artifact.label} warm exited ${warm.exitCode ?? warm.signal}: ${warm.stderr || warm.stdout}`);
  }
  let stats: Record<string, GroupStats> = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const samples: Record<string, number[]> = Object.fromEntries(context.artifacts.map(artifact => [artifact.label, []]));
    for (let index = 0; index < context.samples; index++) for (const artifact of context.artifacts) {
      const sample = yield* measure(artifact);
      if (scan) {
        const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(QueryScanMessage), { onExcessProperty: 'error' })(sample.stdout);
        if (decoded._tag !== 'Success' || !decoded.value.ok) reasons.push(`${artifact.label} scan failed: ${sample.stdout || sample.stderr}`);
      }
      if (sample.exitCode !== 0) reasons.push(`${artifact.label} sample exited ${sample.exitCode ?? sample.signal}: ${sample.stderr || sample.stdout}`);
      samples[artifact.label]!.push(sample.ms);
    }
    stats = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summarize(values)]));
    if (Object.values(stats).every(group => group.valid)) break;
    yield* Effect.sync(() => process.stderr.write(`${label(args)}: invalid group ${attempt + 1}\n`));
  }
  return { candidate: stats.candidate!, ...(stats.baseline ? { baseline: stats.baseline } : {}), reasons };
});
const measuredVerdict = Effect.fn('bench.measuredVerdict')(function*(context: Context, row: BudgetRow, args: readonly string[], limitKind: 'p50' | 'max', scan = false) {
  const group = yield* measureGroup(context, args, limitKind === 'max' ? row.limitMs + 5_000 : undefined, scan);
  const verdict = judge({ command: label(args), candidate: group.candidate, ...(group.baseline ? { baseline: group.baseline } : {}), limitMs: row.limitMs, limitKind, reference: context.reference });
  return { ...verdict, pass: verdict.pass && group.reasons.length === 0, reasons: [...verdict.reasons, ...group.reasons] };
});
const Published = Schema.Struct({ projection: Schema.Struct({ current: Schema.Literal(false), builtAt: Schema.String }) });

const waitForSnapshot = Effect.fn('bench.waitForSnapshot')(function*(context: Context, args: readonly string[], deadlineMs: number, snapshots: Snapshot[]) {
  let ready = true;
  for (const artifact of context.artifacts) {
    const started = performance.now();
    let last = '', published = false;
    while (performance.now() - started < deadlineMs) {
      const attempt = yield* run(context, artifact, ['--json', ...args], Math.max(1, deadlineMs - (performance.now() - started)));
      last = attempt.stdout || attempt.stderr;
      const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(Published), { onExcessProperty: 'ignore' })(attempt.stdout);
      if (attempt.exitCode === 0 && decoded._tag === 'Success') { published = true; break; }
      yield* Effect.sleep('1 second');
    }
    snapshots.push({ command: label(args), artifact: artifact.label, ...(published ? { readyAfterMs: performance.now() - started } : { lastError: last }) });
    ready &&= published;
  }
  return ready;
});
const asyncQuery = (args: readonly string[]) => !args.includes('--fresh') && ((args[0] === 'trace' && (args[1] === 'show' || args[1] === 'gaps')) || (args[0] === 'review' && args[1] === 'render'));

const cliPath = Effect.fn('bench.cli')(function*(context: Context) {
  const rows = yield* budgets('cli');
  const refreshRows = yield* budgets('refresh');
  const deadlineMs = Math.max(...refreshRows.map(row => row.limitMs)) + 30_000;
  const cold = [], verdicts: GroupVerdict[] = [], snapshots: Snapshot[] = [];
  for (const row of rows) for (const args of row.commands) {
    const skipped = yield* skip(context, args);
    if (skipped) { verdicts.push(skipped); continue; }
    let clearFailed = false;
    for (const artifact of context.artifacts) {
      const clear = yield* run(context, artifact, ['cache', 'clear']);
      if (clear.exitCode !== 0) { verdicts.push(failure(args, `Cache clear failed: ${clear.stderr || clear.stdout}`)); clearFailed = true; continue; }
      const first = yield* run(context, artifact, args);
      cold.push({ command: label(args), artifact: artifact.label, ms: first.ms, exitCode: first.exitCode, ...(first.exitCode === 0 ? {} : { output: first.stdout || first.stderr }) });
    }
    if (clearFailed) continue;
    if (asyncQuery(args) && !(yield* waitForSnapshot(context, args, deadlineMs, snapshots))) {
      verdicts.push(failure(args, `No published snapshot within ${deadlineMs}ms`)); continue;
    }
    verdicts.push(yield* measuredVerdict(context, row, args, 'p50'));
  }
  return { verdicts, cold, snapshots };
});
const queryPath = Effect.fn('bench.query')(function*(context: Context) {
  const refreshRows = yield* budgets('refresh');
  const deadlineMs = Math.max(...refreshRows.map(row => row.limitMs)) + 30_000;
  const verdicts: GroupVerdict[] = [], snapshots: Snapshot[] = [];
  for (const row of refreshRows) for (const args of row.commands) {
    verdicts.push((yield* skip(context, args)) ?? (yield* measuredVerdict(context, row, args, 'max', true)));
  }
  for (const row of yield* budgets('query')) for (const args of row.commands) {
    const skipped = yield* skip(context, args);
    if (skipped) { verdicts.push(skipped); continue; }
    if (!(yield* waitForSnapshot(context, args, deadlineMs, snapshots))) { verdicts.push(failure(args, `No published snapshot within ${deadlineMs}ms`)); continue; }
    verdicts.push(yield* measuredVerdict(context, row, args, 'p50'));
  }
  return { verdicts, snapshots };
});

const ViewTiming = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const ViewResult = Schema.Struct({ samples: Schema.Array(Schema.Struct({ workspace: ViewTiming, jobs: ViewTiming, file: ViewTiming, action: ViewTiming })), commit: Schema.String, firstRequestMs: ViewTiming });
/** Reuse the existing frozen HTTP fixture, interleaving artifact invocations by sample. */
const viewPath = Effect.fn('bench.view')(function*(context: Context) {
  const fixture = context.consumer.root, routes: Record<string, Record<string, number[]>> = {};
  const cold = [];
  let commit = '', verdicts: GroupVerdict[] = [];
  const invoke = Effect.fn('bench.view.invoke')(function*(artifact: Artifact) {
    const output = join(context.outputDir, `view-${artifact.label}.json`);
    const argv = [process.execPath, '--import', 'tsx', resolve('scripts/measure-view-requests.ts'), artifact.dir, fixture, output, '1'];
    const result = yield* timedRun(argv, { cwd: resolve('.'), outputDir: context.outputDir, processGroup: true });
    if (result.exitCode !== 0) return yield* new PerfError({ message: `View measurement failed: ${result.stderr || result.stdout}` });
    const decoded = yield* io('Read view samples', () => Schema.decodeUnknownSync(Schema.fromJsonString(ViewResult), { onExcessProperty: 'ignore' })(readFileSync(output, 'utf8')));
    if (decoded.samples.length !== 1) return yield* new PerfError({ message: 'View helper must return the requested single sample' });
    return decoded;
  });
  for (const artifact of context.artifacts) {
    const warm = yield* invoke(artifact); commit = warm.commit;
    cold.push({ command: 'view workspace', artifact: artifact.label, ms: warm.firstRequestMs });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const key of Object.keys(routes)) delete routes[key];
    for (let index = 0; index < context.samples; index++) for (const artifact of context.artifacts) {
      const decoded = yield* invoke(artifact);
      for (const sample of decoded.samples) for (const [route, ms] of Object.entries(sample)) ((routes[route] ??= {})[artifact.label] ??= []).push(ms);
    }
    verdicts = Object.entries(routes).map(([route, byArtifact]) => judge({ command: `view ${route === 'action' ? 'document.set' : route}`, candidate: summarize(byArtifact.candidate!), ...(byArtifact.baseline ? { baseline: summarize(byArtifact.baseline) } : {}), reference: context.reference }));
    if (verdicts.every(v => v.candidate.valid && (v.baseline?.valid ?? true))) break;
  }
  return { verdicts, cold, consumer: { ...context.consumer, commit, scale: { sources: 1112, tests: 0, pages: 110 } } };
});

const main = Effect.gen(function*() {
  const { values, positionals } = yield* io('Parse bench arguments', () => parseArgs({ allowPositionals: true, options: {
    consumer: { type: 'string', default: 'self' }, commit: { type: 'string', default: 'HEAD' }, scale: { type: 'string' },
    baseline: { type: 'string' }, samples: { type: 'string', default: '7' }, reference: { type: 'boolean', default: false },
    out: { type: 'string' }, keep: { type: 'boolean', default: false },
  } }));
  const path = yield* Schema.decodeUnknownEffect(Path)(positionals[0]).pipe(Effect.mapError(() => new PerfError({ message: usage })));
  if (positionals.length !== 1) return yield* new PerfError({ message: usage });
  const samples = yield* Schema.decodeUnknownEffect(Samples)(values.samples).pipe(Effect.mapError(() => new PerfError({ message: '--samples must be 1..100' })));
  const scale = yield* io('Parse scale', () => parseScale(values.scale));
  const candidate = yield* loadArtifact('candidate', '.');
  const artifacts = values.baseline === undefined ? [candidate] : [candidate, yield* loadArtifact('baseline', values.baseline)];
  const workDir = yield* workDirectory('concord-bench-', values.keep), outputDir = join(workDir, 'runs');
  yield* io('Create run directory', () => mkdirSync(outputDir));
  const consumer = path === 'view' ? { kind: 'scale', root: join(outputDir, 'view-consumer'), commit: 'fixture' } satisfies Consumer
    : yield* prepareConsumer(values.consumer, { repository: candidate.dir, commit: values.commit, entry: candidate.entry, scale, workDir });
  const context: Context = { consumer, artifacts, samples, reference: values.reference, outputDir };
  const result = path === 'cli' ? yield* cliPath(context) : path === 'query' ? yield* queryPath(context) : yield* viewPath(context);
  const pass = measurementPass(result.verdicts, consumer.kind);
  const measured = result.verdicts.filter(verdict => !verdict.skipped);
  const acceptanceGaps = [
    ...(!pass ? ['failed verdicts'] : []),
    ...(samples < 7 ? ['samples < 7'] : []),
    ...(measured.some(v => !v.candidate.valid || (v.baseline !== undefined && !v.baseline.valid)) ? ['invalid sample groups'] : []),
    ...(!values.reference && values.baseline === undefined ? ['no baseline and not reference'] : []),
  ];
  const record = {
    format: 'concord.bench/v1', path, measuredAt: new Date().toISOString(), environment: environment(), reference: values.reference, samples,
    consumer, artifacts, ...result, pass, acceptance: acceptanceGaps.length === 0,
    ...(acceptanceGaps.length > 0 ? { acceptanceGaps } : {}),
  };
  yield* io('Write bench record', () => {
    const text = `${JSON.stringify(record, null, 2)}\n`;
    if (values.out !== undefined) writeFileSync(resolve(values.out), text);
    process.stdout.write(text);
    if (!record.pass) process.exitCode = 1;
  });
}).pipe(Effect.scoped);
NodeRuntime.runMain(main);
