import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { NodeRuntime } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { environment, loadArtifact } from './perf/artifact.js';
import { combineProfiles, CpuProfile, hotSpots } from './perf/cpu-profile.js';
import { io, PerfError, timedRun } from './perf/process.js';
import { parseScale, prepareConsumer, settleConsumerRefreshes, workDirectory } from './perf/workspace.js';

const usage = 'Usage: pnpm bench:profile refresh [trace gaps|trace show <ref>|review render [ref]] [--consumer self|scale|<path>] [--commit <rev>] [--scale <sources>,<tests>,<pages>] [--out <dir>] [--warm] [--keep]\n       pnpm bench:profile cli [options] -- <concord arguments>';
const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const CounterRecord = Schema.Struct({
  pid: Schema.Int, ppid: Schema.Int, argv: Schema.Array(Schema.String), exitCode: Schema.Int, wallMs: NonNegative,
  userMs: NonNegative, systemMs: NonNegative, maxRssKiB: NonNegative, fsRead: NonNegative, fsWrite: NonNegative,
  voluntaryContextSwitches: NonNegative, involuntaryContextSwitches: NonNegative,
  fs: Schema.Record(Schema.String, Schema.Struct({ count: Schema.Int, ms: NonNegative })),
});
const Pending = Schema.Struct({ ok: Schema.Literal(false), error: Schema.Literal('QueryPending') });
const validQuery = (args: readonly string[]) =>
  (args[0] === 'trace' && args[1] === 'gaps' && args.length === 2)
  || (args[0] === 'trace' && args[1] === 'show' && args.length === 3)
  || (args[0] === 'review' && args[1] === 'render' && (args.length === 2 || args.length === 3));

/** NODE_OPTIONS is inherited by nested refresh processes; benchmark runs never load these probes. */
const main = Effect.gen(function*() {
  const separator = process.argv.indexOf('--');
  const own = separator < 0 ? process.argv.slice(2) : process.argv.slice(2, separator);
  const passthrough = separator < 0 ? [] : process.argv.slice(separator + 1);
  const { values, positionals } = yield* io('Parse profile arguments', () => parseArgs({ args: own, allowPositionals: true, options: {
    consumer: { type: 'string', default: 'self' }, commit: { type: 'string', default: 'HEAD' }, scale: { type: 'string' },
    out: { type: 'string' }, warm: { type: 'boolean', default: false }, keep: { type: 'boolean', default: false },
  } }));
  const [path, ...query] = positionals;
  if ((path !== 'refresh' && path !== 'cli') || (path === 'cli' && (query.length > 0 || passthrough.length === 0))
    || (path === 'refresh' && (passthrough.length > 0 || (query.length > 0 && !validQuery(query))))) return yield* new PerfError({ message: usage });
  const args = path === 'refresh' ? ['--json', '--fresh', '--dry-run', ...(query.length === 0 ? ['trace', 'gaps'] : query)] : passthrough;
  const scale = yield* io('Parse scale', () => parseScale(values.scale));
  const candidate = yield* loadArtifact('candidate', '.');
  const workDir = yield* workDirectory('concord-profile-', values.keep);
  const consumer = yield* prepareConsumer(values.consumer, { repository: candidate.dir, commit: values.commit, entry: candidate.entry, scale, workDir });
  // Output artifacts intentionally survive; only the work directory is disposable.
  const out = yield* io('Create profile output', () => {
    const dir = values.out === undefined ? mkdtempSync(join(tmpdir(), 'concord-profile-out-')) : resolve(values.out);
    mkdirSync(dir, { recursive: true });
    return realpathSync(dir);
  });
  const previous = yield* io('Inventory profile output', () => new Set(readdirSync(out)));
  const runs = join(workDir, 'runs');
  yield* io('Create run directory', () => mkdirSync(runs));
  const command = [process.execPath, candidate.entry, ...args];
  if (values.warm) {
    const warm = yield* timedRun(command, { cwd: consumer.root, outputDir: runs });
    const output = warm.stderr || warm.stdout;
    const pending = Schema.decodeUnknownExit(Schema.fromJsonString(Pending), { onExcessProperty: 'ignore' })(output);
    if (warm.exitCode !== 0 && pending._tag !== 'Success' && !/(?:^|\n)error: QueryPending(?:\n|$)/u.test(output)) return yield* new PerfError({ message: `Warm command failed: ${output}` });
    yield* settleConsumerRefreshes(consumer);
  }
  const tsx = fileURLToPath(import.meta.resolve('tsx'));
  const counter = fileURLToPath(new URL('./perf/fs-counter.ts', import.meta.url));
  const run = yield* timedRun(command, { cwd: consumer.root, outputDir: runs, env: {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --cpu-prof --cpu-prof-dir=${JSON.stringify(out)} --import ${JSON.stringify(tsx)} --import ${JSON.stringify(counter)}`,
    CONCORD_PERF_COUNTER_DIR: out,
    CONCORD_PERF_COUNTER_ROOT: consumer.root,
  } });
  yield* settleConsumerRefreshes(consumer);
  const processes = yield* io('Decode CPU profiles and counters', () => {
    const files = readdirSync(out).filter(name => !previous.has(name));
    const counters = files.filter(name => /^counter-\d+\.json$/u.test(name)).map(name =>
      Schema.decodeUnknownSync(Schema.fromJsonString(CounterRecord), { onExcessProperty: 'error' })(readFileSync(join(out, name), 'utf8')));
    const profiles = files.filter(name => name.endsWith('.cpuprofile'));
    if (profiles.length === 0 || counters.length === 0) throw new Error(`Missing profile evidence; command exited ${run.exitCode}: ${run.stderr}`);
    const byPid = new Map<number, CpuProfile[]>();
    for (const name of profiles) {
      const match = /^CPU\.\d{8}\.\d{6}\.(\d+)\.\d+(?:\.\d+)?\.cpuprofile$/u.exec(name);
      if (!match) throw new Error(`Unexpected CPU profile name: ${name}`);
      const pid = Number(match[1]);
      const profile = Schema.decodeUnknownSync(Schema.fromJsonString(CpuProfile), { onExcessProperty: 'error' })(readFileSync(join(out, name), 'utf8'));
      const group = byPid.get(pid) ?? [];
      group.push(profile);
      byPid.set(pid, group);
    }
    if (counters.some(item => !byPid.has(item.pid))) throw new Error('A counter has no matching CPU profile');
    return [...byPid].map(([pid, profiles]) => {
      const record = counters.find(item => item.pid === pid);
      if (!record) throw new Error(`Missing fs counter for pid ${pid}`);
      const { fs, ...resources } = record;
      return { pid, resources: { ...resources, fs: Object.fromEntries(Object.entries(fs).sort((a, b) => b[1].count - a[1].count)) }, ...hotSpots(combineProfiles(profiles)) };
    });
  });
  const record = {
    format: 'concord.profile/v1', path, measuredAt: new Date().toISOString(), environment: environment(), consumer, artifact: candidate,
    command: ['concord', ...args], wallMs: run.ms, exitCode: run.exitCode, stderr: run.stderr, stdout: run.stdout, output: out,
    note: 'Wall time includes profiler and counter overhead; compare profiles with each other, not with benchmark samples.', processes,
  };
  yield* io('Write profile summary', () => {
    const text = `${JSON.stringify(record, null, 2)}\n`;
    writeFileSync(join(out, 'summary.json'), text);
    process.stdout.write(text);
    process.stderr.write(`profile written to ${out}\n`);
    if (run.exitCode !== 0) process.exitCode = 1;
  });
}).pipe(Effect.scoped);
NodeRuntime.runMain(main);
