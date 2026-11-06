// @concord-file
// @concord-implements docs/engineering/testing/README.md#共享资源与同步
// @concord-implements docs/engineering/testing/cli.md#并发
import { Duration, Effect, Exit, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { availableParallelism, totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export const GiB = 1024 ** 3;
const BrowserBudget = 2.5 * GiB;
const PositiveInteger = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
);
export class GateResourcesInvalid extends Schema.TaggedError<GateResourcesInvalid>()('GateResourcesInvalid', {
  detail: Schema.String,
}) {}

/** Round the half-physical budget down to whole GiB, including on the 31 GiB host. */
export const gateMemoryMax = (physicalBytes = totalmem()): number => Math.max(1, Math.floor(physicalBytes / GiB / 2)) * GiB;

export const gateConcurrency = (memoryMaxBytes: number, cpus = availableParallelism(), env: NodeJS.ProcessEnv = process.env) => {
  const read = (name: string): number | undefined => {
    if (env[name] === undefined) return undefined;
    try {
      if (!/^[1-9]\d*$/u.test(env[name])) throw new Error('Expected a positive integer');
      return Schema.decodeUnknownSync(PositiveInteger)(env[name]);
    }
    catch (cause) { throw new GateResourcesInvalid({ detail: `${name}: ${String(cause)}` }); }
  };
  const explicitNode = read('CONCORD_TEST_CONCURRENCY');
  const explicitBrowser = read('CONCORD_E2E_WORKERS');
  const cpuLimit = Math.max(1, Math.min(8, Math.floor(cpus / 2)));
  const browserLimit = Math.max(1, Math.min(4, Math.floor(memoryMaxBytes / 4 / BrowserBudget)));
  let browser = explicitBrowser ?? Math.min(browserLimit, explicitNode ?? cpuLimit);
  let node = explicitNode ?? Math.max(1, Math.min(cpuLimit, Math.floor((memoryMaxBytes - browser * BrowserBudget) / GiB)));
  // Resolve the mutual default dependency; an explicit override remains authoritative.
  for (;;) {
    const nextBrowser = explicitBrowser ?? Math.max(1, Math.min(browserLimit, node));
    const nextNode = explicitNode ?? Math.max(1, Math.min(cpuLimit, Math.floor((memoryMaxBytes - nextBrowser * BrowserBudget) / GiB)));
    if (nextBrowser === browser && nextNode === node) break;
    browser = nextBrowser;
    node = nextNode;
  }
  return { node, browser, availableNodeMemoryBytes: Math.max(0, memoryMaxBytes - browser * BrowserBudget) };
};

export const currentGateMemoryMax = (): number => {
  if (process.env.CONCORD_GATE_MEMORY_MAX === undefined) return gateMemoryMax();
  try {
    if (!/^[1-9]\d*$/u.test(process.env.CONCORD_GATE_MEMORY_MAX)) throw new Error('Expected a positive integer');
    return Schema.decodeUnknownSync(PositiveInteger)(process.env.CONCORD_GATE_MEMORY_MAX);
  }
  catch (cause) { throw new GateResourcesInvalid({ detail: `CONCORD_GATE_MEMORY_MAX: ${String(cause)}` }); }
};

const MemoryReport = Schema.Struct({
  memoryIsolation: Schema.Literals(['systemd-scope', 'unavailable']),
  reason: Schema.NullOr(Schema.String),
  memoryMaxBytes: Schema.Number,
  memorySwapMaxBytes: Schema.NullOr(Schema.Number),
  memoryPeakBytes: Schema.NullOr(Schema.Number),
  memorySwapPeakBytes: Schema.NullOr(Schema.Number),
  cgroup: Schema.NullOr(Schema.String),
  unit: Schema.NullOr(Schema.String),
  nodeConcurrency: Schema.Number,
  browserWorkers: Schema.Number,
  exitCode: Schema.NullOr(Schema.Number),
});
type MemoryReport = typeof MemoryReport.Type;

const writeReport = Effect.fn('gate.resources.report')(function*(output: string, report: MemoryReport) {
  const fs = yield* FileSystem.FileSystem;
  const target = join(output, 'resources.json');
  const temporary = `${target}.${randomUUID()}.tmp`;
  yield* fs.writeFileString(temporary, `${JSON.stringify(report, null, 2)}\n`);
  yield* fs.rename(temporary, target);
});

const cgroupDirectory = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const membership = yield* fs.readFileString('/proc/self/cgroup');
  const group = membership.split('\n').find(line => line.startsWith('0::'))?.slice(3);
  if (!group?.startsWith('/')) return yield* new GateResourcesInvalid({ detail: 'A unified cgroup membership is required for the gate scope.' });
  return join('/sys/fs/cgroup', group);
});

const scopeUnavailable = Effect.gen(function*() {
  if (process.platform !== 'linux') return `systemd user scopes are unavailable on ${process.platform}`;
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists('/sys/fs/cgroup/cgroup.controllers'))) return 'The unified cgroup hierarchy is unavailable';
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(ChildProcess.make('systemctl', ['--user', 'show-environment'], {
    stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
  })).pipe(
    Effect.map(code => Number(code) === 0 ? null : `systemctl --user show-environment exited ${code}`),
    Effect.catch(cause => Effect.succeed(String(cause))),
  );
});

/** The supervisor stays outside the scope, so it can persist an OOM result. */
export const withGateResources = <E, R>(body: Effect.Effect<void, E, R>, options: {
  readonly memoryMaxBytes?: number;
  readonly reportRoot?: string;
} = {}) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const memoryMaxBytes = options.memoryMaxBytes ?? currentGateMemoryMax();
  const concurrency = yield* Effect.try({ try: () => gateConcurrency(memoryMaxBytes), catch: cause => cause instanceof GateResourcesInvalid ? cause : new GateResourcesInvalid({ detail: String(cause) }) });
  const inheritedUnit = process.env.CONCORD_GATE_SCOPE;
  const inheritedOutput = process.env.CONCORD_GATE_REPORT;
  if (inheritedUnit && inheritedOutput) {
    const directory = yield* cgroupDirectory;
    const actualMax = (yield* fs.readFileString(join(directory, 'memory.max'))).trim();
    const actualSwapMax = (yield* fs.readFileString(join(directory, 'memory.swap.max'))).trim();
    if (!directory.endsWith(`/${inheritedUnit}`) || actualMax !== String(memoryMaxBytes) || actualSwapMax !== '0') {
      return yield* new GateResourcesInvalid({ detail: `Gate scope does not own its requested memory boundary: ${directory}, memory.max=${actualMax}, memory.swap.max=${actualSwapMax}` });
    }
    // The re-exec token belongs only to this entry, never its test descendants.
    yield* Effect.sync(() => { delete process.env.CONCORD_GATE_SCOPE; });
    const base: MemoryReport = {
      memoryIsolation: 'systemd-scope', reason: null, memoryMaxBytes, memorySwapMaxBytes: 0,
      memoryPeakBytes: null, memorySwapPeakBytes: null, cgroup: directory, unit: inheritedUnit,
      nodeConcurrency: concurrency.node, browserWorkers: concurrency.browser, exitCode: null,
    };
    yield* writeReport(inheritedOutput, base);
    const record = (failed: boolean) => Effect.gen(function*() {
      const peak = Number((yield* fs.readFileString(join(directory, 'memory.peak'))).trim());
      const swap = yield* fs.readFileString(join(directory, 'memory.swap.peak')).pipe(Effect.map(value => Number(value.trim())), Effect.catch(() => Effect.succeed(null)));
      yield* writeReport(inheritedOutput, { ...base, memoryPeakBytes: peak, memorySwapPeakBytes: swap, exitCode: failed ? 1 : Number(process.exitCode ?? 0) });
    });
    yield* body.pipe(Effect.scoped, Effect.onExit(exit => record(Exit.isFailure(exit)).pipe(Effect.orDie)));
    return;
  }

  const root = resolve(options.reportRoot ?? '.test-results');
  yield* fs.makeDirectory(root, { recursive: true });
  const output = yield* fs.makeTempDirectory({ directory: root, prefix: 'run-' });
  yield* Effect.sync(() => console.error(`# Gate resource report: ${join(output, 'resources.json')}`));
  const unavailable = yield* scopeUnavailable;
  const unit = `concord-gate-${randomUUID()}.scope`;
  const base: MemoryReport = {
    memoryIsolation: unavailable === null ? 'systemd-scope' : 'unavailable', reason: unavailable,
    memoryMaxBytes, memorySwapMaxBytes: unavailable === null ? 0 : null,
    memoryPeakBytes: null, memorySwapPeakBytes: null, cgroup: null, unit: unavailable === null ? unit : null,
    nodeConcurrency: concurrency.node, browserWorkers: concurrency.browser, exitCode: null,
  };
  yield* writeReport(output, base);
  const directly = (reason: string) => Effect.gen(function*() {
    yield* Effect.sync(() => { process.env.CONCORD_GATE_MEMORY_MAX = String(memoryMaxBytes); process.env.CONCORD_GATE_REPORT = output; });
    yield* body.pipe(Effect.scoped, Effect.onExit(exit => writeReport(output, { ...base, memoryIsolation: 'unavailable', reason,
      unit: null, memorySwapMaxBytes: null, exitCode: Exit.isFailure(exit) ? 1 : Number(process.exitCode ?? 0) }).pipe(Effect.orDie)));
  });
  if (unavailable !== null) return yield* directly(unavailable);

  let code: number | null = null;
  let scopeStarted = false;
  const finalize = Effect.gen(function*() {
    let report = yield* fs.readFileString(join(output, 'resources.json')).pipe(Effect.map(Schema.decodeUnknownSync(Schema.fromJsonString(MemoryReport))));
    // systemd retains peaks for failed/OOM units even after removing their cgroup.
    const properties = yield* spawner.string(ChildProcess.make('systemctl', ['--user', 'show', unit, '--property=MemoryPeak,MemorySwapPeak,Result,InvocationID'], {
      stdin: 'ignore', stderr: 'ignore',
    })).pipe(Effect.catch(() => Effect.succeed('')));
    scopeStarted = /^InvocationID=[0-9a-f]+$/mu.test(properties);
    const propertyPeak = (name: string): number | null => {
      const raw = properties.split('\n').find(line => line.startsWith(`${name}=`))?.slice(name.length + 1);
      return raw !== undefined && /^\d+$/u.test(raw) ? Number(raw) : null;
    };
    report = { ...report, exitCode: code,
      memoryPeakBytes: propertyPeak('MemoryPeak') ?? report.memoryPeakBytes,
      memorySwapPeakBytes: propertyPeak('MemorySwapPeak') ?? report.memorySwapPeakBytes };
    yield* writeReport(output, report);
    yield* Effect.sync(() => console.error(`# Gate memory peak: ${report.memoryPeakBytes ?? 'unavailable'} bytes; swap peak: ${report.memorySwapPeakBytes ?? 'unavailable'} bytes; MemoryMax=${memoryMaxBytes}`));
    // Killing systemd-run's process group alone cannot own an independent scope.
    yield* spawner.exitCode(ChildProcess.make('systemctl', ['--user', 'stop', unit], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })).pipe(Effect.ignore);
    if (report.cgroup !== null && (yield* fs.exists(join(report.cgroup, 'cgroup.procs')))) {
      const survivors = (yield* fs.readFileString(join(report.cgroup, 'cgroup.procs'))).trim();
      if (survivors !== '') return yield* new GateResourcesInvalid({ detail: `Gate scope cleanup left processes: ${unit}: ${survivors}` });
    }
    // Only this invocation's unit; never reset other failed user units.
    yield* spawner.exitCode(ChildProcess.make('systemctl', ['--user', 'reset-failed', unit], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })).pipe(Effect.ignore);
  });
  yield* Effect.scoped(Effect.gen(function*() {
    const child = yield* spawner.spawn(ChildProcess.make('systemd-run', [
      '--user', '--scope', '--quiet', `--unit=${unit}`, '--slice=app.slice',
      '-p', `MemoryMax=${memoryMaxBytes}`, '-p', 'MemorySwapMax=0', '-p', 'MemoryAccounting=yes', '-p', 'OOMPolicy=kill',
      '--', process.execPath, ...process.execArgv, ...process.argv.slice(1),
    ], {
      env: { ...process.env, CONCORD_GATE_SCOPE: unit, CONCORD_GATE_REPORT: output, CONCORD_GATE_MEMORY_MAX: String(memoryMaxBytes) },
      stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: Duration.seconds(10),
    }));
    code = Number(yield* child.exitCode);
  })).pipe(
    Effect.catch(cause => Effect.sync(() => { console.error(`# Gate scope execution: ${String(cause)}`); code = 1; })),
    Effect.ensuring(finalize.pipe(Effect.orDie)),
  );
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(MemoryReport))(yield* fs.readFileString(join(output, 'resources.json')));
  if (report.cgroup === null && !scopeStarted) return yield* directly(`systemd-run could not start the gate scope (exit ${code})`);
  yield* Effect.sync(() => { process.exitCode = code ?? 1; });
});
