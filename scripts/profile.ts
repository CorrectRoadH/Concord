import { packageBin } from './package-location.ts';
import { archiveTarget } from './archive-support.ts';
import { bunCompilerIdentity, compilationArguments } from './compile-application.ts';
import { compiledStartupReceipts } from './compile-startup.ts';
import { tmpdir } from 'node:os';
import { cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packJavaScript } from './pack-javascript.ts';
import { parseArgs } from 'node:util';
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { loadBudgets } from './perf/budgets.ts';
import { environment, loadArtifact } from './perf/artifact.ts';
import { combineProfiles, CpuProfile, hotSpots, profileRuntimeArgument } from './perf/cpu-profile.ts';
import { io, mustRun, PerfError, timedRun } from './perf/process.ts';
import { executeScenario, loadScenarios, makeContext, runArguments, cliCommand } from './perf/scenario.ts';
import { parseScale, prepareConsumer, settleConsumerRefreshes, workDirectory } from './perf/workspace.ts';
import { buildForMeasurement } from './measurement-build.ts';

const usage = 'Usage: vp run bench:profile <scenario ID> [--warm] [--out <dir>] [--keep]\n       vp run bench:profile cli [options] -- <concord arguments>';
const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const CounterRecord = Schema.Struct({
  pid: Schema.Int, ppid: Schema.Int, argv: Schema.Array(Schema.String), exitCode: Schema.Int, wallMs: NonNegative,
  userMs: NonNegative, systemMs: NonNegative, maxRssKiB: NonNegative, fsRead: NonNegative, fsWrite: NonNegative,
  voluntaryContextSwitches: NonNegative, involuntaryContextSwitches: NonNegative,
  fs: Schema.Record(Schema.String, Schema.Struct({ count: Schema.Int, ms: NonNegative })),
});

export const copyProfilePackage = Effect.fn('perf.copyProfilePackage')(function*(candidatePackage: string, profilePackage: string) {
  // Resolving relative package links would make the private copy escape to the candidate.
  yield* Effect.tryPromise({
    try: () => cp(candidatePackage, profilePackage, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true }),
    catch: cause => new PerfError({ message: `Copy profile archive: ${String(cause)}` }),
  });
});

export function summarizeProfileEvidence(evidence: ReadonlyMap<string, string>, _completedPreparationCounters: ReadonlySet<string> = new Set()) {
  const files = [...evidence.keys()];
  const counters = files.filter(name => /^counter-\d+\.json$/u.test(name)).map(name =>
    Schema.decodeUnknownSync(Schema.fromJsonString(CounterRecord), { onExcessProperty: 'error' })(evidence.get(name)!));
  const profiles = files.filter(name => name.endsWith('.cpuprofile'));
  if (profiles.length === 0 || counters.length === 0) throw new Error('Missing profile evidence');
  const byPid = new Map<number, CpuProfile[]>();
  for (const name of profiles) {
    const match = /^CPU\.\d{8}\.\d{6}\.(\d+)\.\d+(?:\.\d+)?\.cpuprofile$/u.exec(name);
    if (!match) throw new Error(`Unexpected CPU profile name: ${name}`);
    const pid = Number(match[1]);
    const profile = Schema.decodeUnknownSync(Schema.fromJsonString(CpuProfile), { onExcessProperty: 'error' })(evidence.get(name)!);
    const group = byPid.get(pid) ?? [];
    group.push(profile);
    byPid.set(pid, group);
  }
  if (counters.some(item => !byPid.has(item.pid))) throw new Error('A counter has no matching CPU profile');
  return counters.map(record => {
    const { pid } = record;
    const profiles = byPid.get(pid)!;
    const { fs, ...resources } = record;
    return { pid, resources: { ...resources, fs: Object.fromEntries(Object.entries(fs).sort((a, b) => b[1].count - a[1].count)) }, ...hotSpots(combineProfiles(profiles)) };
  });
}
/** A private compiled executable carries profiler flags into its internal children. */
const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const separator = process.argv.indexOf('--');
  const own = separator < 0 ? process.argv.slice(2) : process.argv.slice(2, separator);
  const passthrough = separator < 0 ? [] : process.argv.slice(separator + 1);
  const { values, positionals } = yield* io('Parse profile arguments', () => parseArgs({ args: own, allowPositionals: true, options: {
    consumer: { type: 'string' }, commit: { type: 'string', default: 'HEAD' }, scale: { type: 'string' },
    out: { type: 'string' }, warm: { type: 'boolean', default: false }, keep: { type: 'boolean', default: false },
  } }));
  const [path] = positionals;
  const scenarios = yield* loadScenarios(resolve('.'));
  const budgets = yield* loadBudgets(resolve('.'));
  const scenario = scenarios.find(s => s.id === path);
  if (positionals.length !== 1 || (path !== 'cli' && (!scenario || passthrough.length)) || (path === 'cli' && !passthrough.length)) return yield* new PerfError({ message: usage });
  const args = scenario ? runArguments(scenario.run) : passthrough;
  const scale = yield* io('Parse scale', () => parseScale(values.scale));
  const workDir = yield* workDirectory('concord-profile-', values.keep);
  const runs = join(workDir, 'runs');
  yield* fs.makeDirectory(runs);
  const candidatePackage = yield* buildForMeasurement(resolve('.'), runs);
  // Output artifacts intentionally survive; only the work directory is disposable.
  const dir = values.out === undefined ? yield* fs.makeTempDirectory({ directory: tmpdir(), prefix: 'concord-profile-out-' }) : resolve(values.out);
  yield* fs.makeDirectory(dir, { recursive: true });
  const out = yield* fs.realPath(dir);
  // Bun splits compile-exec-argv on whitespace. Keep its runtime paths private
  // and whitespace-free, independently of the checkout, TMPDIR and requested output.
  const sampling = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ directory: '/tmp', prefix: 'concord-profile-sampling-' }));
  if (/\s/u.test(sampling)) return yield* new PerfError({ message: `Bun profile runtime path contains whitespace: ${sampling}` });
  // Preserve raw evidence even when decoding or the measured command fails.
  yield* Effect.addFinalizer(() => Effect.gen(function*() {
    for (const name of yield* fs.readDirectory(sampling)) {
      if (/^counter-\d+\.json$/u.test(name) || name.endsWith('.cpuprofile')) yield* fs.copyFile(join(sampling, name), join(out, name));
    }
  }).pipe(Effect.orDie));
  const counter = join(sampling, 'fs-counter.mjs');
  yield* packJavaScript({ entry: { 'fs-counter': fileURLToPath(new URL('./perf/fs-counter.ts', import.meta.url)) }, outDir: sampling,
    platform: 'node', format: 'esm', target: 'node24', logLevel: 'silent',
    deps: { alwaysBundle: /.*/u, onlyBundle: false }, outputOptions: { entryFileNames: '[name].mjs' },
  }).pipe(Effect.mapError(cause => new PerfError({ message: `Build profile preload: ${String(cause)}` })));
  const profilePackage = join(workDir, 'profile-install');
  yield* copyProfilePackage(candidatePackage, profilePackage);
  const profileEntry = yield* packageBin(profilePackage);
  const repository = resolve('.');
  const target = archiveTarget(`${process.platform}-${process.arch}`);
  yield* bunCompilerIdentity(repository, target);
  const receipts = yield* compiledStartupReceipts(repository);
  const compiled = yield* mustRun(['bun', ...compilationArguments(target, profileEntry),
    '--define', `CONCORD_STARTUP_RECEIPTS=${JSON.stringify(receipts)}`,
    profileRuntimeArgument(sampling, counter),
  ], { cwd: repository, outputDir: runs, timeoutMs: 120_000 });
  yield* io('Report profile compilation', () => process.stderr.write(compiled.stdout + compiled.stderr));
  const candidate = yield* loadArtifact('candidate', repository, profileEntry);
  // Stop owned services before collecting profiles: Bun writes them on exit.
  const { consumer, run } = yield* Effect.gen(function*() {
  const consumer = yield* prepareConsumer(values.consumer ?? scenario?.consumer ?? 'self', { repository: candidate.dir, commit: values.commit, entry: candidate.entry, scale, workDir });
  const command = cliCommand(candidate, consumer.root, args);
  const env = {
    CONCORD_PERF_COUNTER_DIR: sampling, CONCORD_PERF_COUNTER_ROOT: consumer.root,
  };
  const run = yield* Effect.gen(function*() {
    const context = makeContext(candidate, consumer, runs, false, env, Math.max(0, ...budgets.filter(row => row.limitKind === 'max').map(row => row.limitMs)));
    if (scenario) {
      if (scenario.prepare) yield* scenario.prepare(context);
      if (values.warm) yield* executeScenario(scenario, context);
      const result = yield* executeScenario(scenario, context);
      yield* settleConsumerRefreshes(consumer);
      return result;
    }
    if (values.warm) {
      const warm = yield* timedRun(command, { cwd: consumer.root, outputDir: runs });
      const output = warm.stderr || warm.stdout;
      const pending = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literal('QueryPending'), message: Schema.String, details: Schema.optionalKey(Schema.Json) })), { onExcessProperty: 'error' })(output);
      if (warm.exitCode !== 0 && pending._tag !== 'Success' && !/(?:^|\n)error: QueryPending(?:\n|$)/u.test(output)) return yield* new PerfError({ message: `Warm command failed: ${output}` });
      yield* settleConsumerRefreshes(consumer);
    }
    const result = yield* timedRun(command, { cwd: consumer.root, outputDir: runs, env });
    yield* settleConsumerRefreshes(consumer);
    return result;
  }).pipe(Effect.scoped);
  return { consumer, run };
  }).pipe(Effect.scoped);
  const files = yield* fs.readDirectory(sampling);
  const evidence = new Map<string, string>();
  for (const name of files.filter(name => /^counter-\d+\.json$/u.test(name) || name.endsWith('.cpuprofile'))) evidence.set(name, yield* fs.readFileString(join(sampling, name)));
  const processes = yield* io(`Decode CPU profiles and counters; command exited ${run.exitCode}: ${run.stderr}`, () => summarizeProfileEvidence(evidence));
  const record = {
    format: 'concord.profile/v2', ...(scenario ? { scenario: scenario.id } : {}), path, measuredAt: new Date().toISOString(), environment: environment(), consumer, artifact: candidate,
    command: ['concord', ...(scenario && 'scan' in scenario.run ? ['--json', '--fresh', '--dry-run', ...scenario.run.scan] : args)], wallMs: run.ms, exitCode: run.exitCode, stderr: run.stderr, stdout: run.stdout, output: out,
    note: 'Wall time includes profiler and counter overhead; compare profiles with each other, not with benchmark samples.' + (scenario && 'request' in scenario.run ? ' HTTP process profiles include server preparation and shutdown.' : ''), processes,
  };
  const text = `${JSON.stringify(record, null, 2)}\n`;
  yield* fs.writeFileString(join(out, 'summary.json'), text);
  yield* io('Write profile summary', () => {
    process.stdout.write(text);
    process.stderr.write(`profile written to ${out}\n`);
    if (run.exitCode !== (scenario?.expect.exitCode ?? 0)) process.exitCode = 1;
  });
}).pipe(Effect.scoped);
if (import.meta.main) main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
