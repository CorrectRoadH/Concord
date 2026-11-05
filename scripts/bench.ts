import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { environment, loadArtifact, verifyArtifact } from './perf/artifact.js';
import { loadBudgets, missingOwner } from './perf/budgets.js';
import { prepareBaseline } from './perf/baseline.js';
import { changedSelection, defaultBase, selectScenarios } from './perf/selection.js';
import { executeScenario, loadScenarios, makeContext, prepareServer, runArguments, type BenchContext } from './perf/scenario.js';
import { io, mustRun, PerfError } from './perf/process.js';
import { judge, measurementPass, skippedVerdict, summarize, type GroupStats, type GroupVerdict } from './perf/stats.js';
import { parseScale, prepareConsumer, settleConsumerRefreshes, workDirectory } from './perf/workspace.js';
import { buildForMeasurement } from './measurement-build.js';

/** Normalize flags with optional values without consuming the following selection. */
function optionalRevisions(argv: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--changed' || arg === '--compare') {
      const next = argv[i + 1];
      result.push(`${arg}=${next && !next.startsWith('--') ? argv[++i] : ''}`);
    } else result.push(arg);
  }
  return result;
}
const main = Effect.gen(function*() {
  const { values, positionals } = yield* io('Parse bench arguments', () => parseArgs({ args: optionalRevisions(process.argv.slice(2)), allowPositionals: true, options: {
    consumer: { type: 'string' }, commit: { type: 'string', default: 'HEAD' }, scale: { type: 'string' },
    changed: { type: 'string' }, compare: { type: 'string' }, quick: { type: 'boolean', default: false },
    samples: { type: 'string', default: '7' }, reference: { type: 'boolean', default: false },
    out: { type: 'string' }, keep: { type: 'boolean', default: false },
  } }));
  const requested = yield* io('Decode sample count', () => Schema.decodeUnknownSync(Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })))(values.samples));
  const samples = values.quick ? 3 : requested;
  const scale = yield* io('Parse scale', () => parseScale(values.scale));
  const root = resolve('.');
  const workDir = yield* workDirectory('concord-bench-', values.keep), outputDir = join(workDir, 'runs');
  yield* io('Create run directory', () => mkdirSync(outputDir));
  yield* buildForMeasurement(root, outputDir);
  const candidate = yield* loadArtifact('candidate', root);
  const base = values.changed !== undefined || values.compare !== undefined ? (values.changed !== undefined ? values.changed || (yield* defaultBase(root, outputDir)) : values.compare || (yield* defaultBase(root, outputDir))) : undefined;
  const scenarios = yield* loadScenarios(root), budgets = yield* loadBudgets(root);
  const changed = values.changed === undefined ? undefined : yield* changedSelection(root, candidate.entry, base!, outputDir);
  const selected = yield* io('Select scenarios', () => selectScenarios(scenarios, positionals, changed));
  const artifacts = values.compare === undefined ? [candidate] : [candidate, yield* prepareBaseline(root, values.compare || base!, outputDir)];
  const contexts = new Map<string, BenchContext>();
  const frozenConsumers = new Map<string, BenchContext['consumer']>();
  const verdicts: (GroupVerdict & { readonly scenario: string; readonly budget?: { owner: string; heading: string } })[] = [];
  const snapshots: { scenario: string; artifact: string; lastError: string }[] = [];
  const cold: { scenario: string; artifact: string; ms: number; exitCode: number | null }[] = [];
  for (const scenario of selected) {
    const matching = budgets.filter(row => row.scenarios.includes(scenario.id));
    if (matching.length !== 1) return yield* new PerfError({ message: `${scenario.id} must have exactly one budget row` });
    const budget = matching[0]!;
    const kind = values.consumer ?? scenario.consumer;
    const perArtifact: BenchContext[] = [];
    for (const artifact of artifacts) {
      const condition = `${kind}:${scenario.server ?? 'absent'}`;
      const contextKey = `${condition}:${artifact.label}`;
      let context = contexts.get(contextKey);
      if (!context) {
        const frozen = frozenConsumers.get(condition);
        const consumerDir = join(workDir, `consumer-${contexts.size}`);
        yield* io('Create consumer directory', () => mkdirSync(consumerDir));
        let consumer = frozen;
        if (!consumer) {
          consumer = yield* prepareConsumer(kind, { repository: root, commit: values.commit, entry: candidate.entry, scale, workDir: consumerDir });
          frozenConsumers.set(condition, consumer);
        }
        if (values.compare !== undefined) {
          const frozen = frozenConsumers.get(condition)!;
          const cloneDir = join(consumerDir, 'artifact');
          yield* io('Create isolated artifact directory', () => mkdirSync(cloneDir));
          const clone = yield* prepareConsumer('self', { repository: frozen.root, commit: frozen.commit, entry: artifact.entry, scale, workDir: cloneDir });
          consumer = { ...frozen, root: clone.root, cache: 'ready' };
        }
        context = makeContext(artifact, consumer, outputDir, false, undefined, Math.max(0, ...budgets.filter(row => row.limitKind === 'max').map(row => row.limitMs))); contexts.set(contextKey, context);
      }
      perArtifact.push(context);
    }
    const context = perArtifact[0]!;
    const absent = perArtifact.map(c => missingOwner(runArguments(scenario.run), path => existsSync(join(c.consumer.root, path)))).find(Boolean);
    if (absent) { verdicts.push({ ...skippedVerdict(scenario.id, context.consumer.kind, absent), scenario: scenario.id }); continue; }
    let preparationFailed = false;
    // Both artifacts use the same frozen sources with independent caches and services.
    for (const phase of ['cold', 'warm'] as const) {
      for (const c of perArtifact) {
        const prepared = yield* Effect.result(Effect.gen(function*() {
          if (phase === 'warm' && scenario.server === 'running') yield* prepareServer(c);
          if (phase === 'warm' && scenario.prepare) yield* scenario.prepare(c);
          if (scenario.state === 'warm') {
            // Record cold separately, then restore a valid cache before warm measurement.
            if (phase === 'cold' && scenario.server !== 'running' && !scenario.prepare && !('request' in scenario.run) && !('scan' in scenario.run)) {
              const clear = yield* c.cli(['cache', 'clear']);
              if (clear.exitCode !== 0) return yield* new PerfError({ message: `Cache clear failed: ${clear.stderr || clear.stdout}` });
              const first = yield* c.cli(runArguments(scenario.run));
              cold.push({ scenario: scenario.id, artifact: c.artifact.label, ms: first.ms, exitCode: first.exitCode });
              const rebuild = yield* c.cli(['cache', 'rebuild']);
              if (rebuild.exitCode !== 0) return yield* new PerfError({ message: `Cache rebuild failed: ${rebuild.stderr || rebuild.stdout}` });
            }
            if (phase === 'warm') yield* executeScenario(scenario, c, budget.limitKind === 'max' ? budget.limitMs + 5000 : undefined);
          }
        }));
        if (prepared._tag === 'Failure') {
          const message = String(prepared.failure);
          snapshots.push({ scenario: scenario.id, artifact: c.artifact.label, lastError: message });
          verdicts.push({ command: scenario.id, scenario: scenario.id, candidate: { samples: [], p50: 0, max: 0, valid: false }, pass: false, reasons: [message] }); preparationFailed = true;
        }
      }
      if (preparationFailed) break;
    }
    if (preparationFailed) continue;
    let groups: Record<string, GroupStats> = {}, errors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const timings: Record<string, number[]> = Object.fromEntries(artifacts.map(a => [a.label, []])); errors = [];
      for (let i = 0; i < samples; i++) for (const c of perArtifact) {
        const result = yield* Effect.result(executeScenario(scenario, c, budget.limitKind === 'max' ? budget.limitMs + 5000 : undefined));
        if (result._tag === 'Failure') errors.push(`${c.artifact.label}: ${String(result.failure)}`);
        else timings[c.artifact.label]!.push(result.success.ms);
      }
      groups = Object.fromEntries(Object.entries(timings).map(([label, times]) => [label, times.length ? summarize(times) : { samples: [], p50: 0, max: 0, valid: false }]));
      if (Object.values(groups).every(group => group.valid) || errors.length) break;
    }
    const verdict = judge({ command: scenario.id, candidate: groups.candidate!, ...(groups.baseline ? { baseline: groups.baseline } : {}), limitMs: budget.limitMs, limitKind: budget.limitKind, reference: values.reference });
    verdicts.push({ ...verdict, scenario: scenario.id, budget: { owner: budget.owner, heading: budget.heading }, pass: verdict.pass && errors.length === 0, reasons: [...verdict.reasons, ...errors] });
    yield* io('Report measurement progress', () => process.stderr.write(`${scenario.id}: p50 ${verdict.candidate.p50.toFixed(1)}ms ${verdict.pass && !errors.length ? 'pass' : 'FAIL'}\n`));
  }
  for (const artifact of artifacts) {
    yield* verifyArtifact(artifact);
  }
  for (const c of contexts.values()) {
    yield* settleConsumerRefreshes(c.consumer);
    const status = (yield* mustRun(['git', 'status', '--porcelain'], { cwd: c.consumer.root, outputDir })).stdout.trim();
    const head = (yield* mustRun(['git', 'rev-parse', 'HEAD'], { cwd: c.consumer.root, outputDir })).stdout.trim();
    if (status || head !== c.consumer.commit) return yield* new PerfError({ message: `Scenario modified frozen consumer ${c.consumer.root}: ${status || `HEAD changed to ${head}`}` });
  }
  const pass = verdicts.every(verdict => verdict.pass);
  const measured = verdicts.filter(v => !v.skipped);
  const acceptanceGaps = [...(!pass ? ['failed verdicts'] : []), ...(samples < 7 || measured.some(v => v.candidate.samples.length < 7 || (v.baseline !== undefined && v.baseline.samples.length < 7)) ? ['samples < 7'] : []),
    ...(measured.some(v => !v.candidate.valid || (v.baseline && !v.baseline.valid)) ? ['invalid sample groups'] : []),
    ...(values.quick ? ['quick mode'] : []), ...(!values.reference && values.compare === undefined ? ['no baseline and not reference'] : []),
    ...(measured.length === 0 ? ['no measured scenarios'] : [])];
  const record = { format: 'concord.bench/v2', selection: { ...(values.changed !== undefined ? { changed: `${base}...worktree` } : {}), scenarios: selected.map(s => s.id) },
    scenarioEnvironments: Object.fromEntries(selected.filter(s => s.env !== undefined).map(s => [s.id, Object.fromEntries(Object.entries(s.env!).map(([key, value]) => [key, value ?? 'unset']))])),
    measuredAt: new Date().toISOString(), environment: environment(), reference: values.reference, samples, artifacts,
    consumers: Object.fromEntries([...contexts].map(([key, c]) => [key, c.consumer])), cold, snapshots, verdicts, pass, acceptance: acceptanceGaps.length === 0,
    ...(acceptanceGaps.length ? { acceptanceGaps } : {}) };
  yield* io('Write bench record', () => { const text = `${JSON.stringify(record, null, 2)}\n`; if (values.out) writeFileSync(resolve(values.out), text); process.stdout.write(text); if (!pass) process.exitCode = 1; });
}).pipe(Effect.scoped);
NodeRuntime.runMain(main);
