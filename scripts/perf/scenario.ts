import { installationResources, installationRootForBin } from '../../src/base/installation/index.js';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, FileSystem, Schema } from 'effect';
import type { Scope } from 'effect';
import type { Artifact } from './artifact.js';
import type { Consumer } from './consumer.js';
import { io, mustRun, PerfError, timedRun, type TimedRun } from './process.js';

export interface BenchContext {
  readonly artifact: Artifact; readonly consumer: Consumer; readonly outputDir: string;
  readonly smoke: boolean; readonly refreshLimitMs: number; readonly env?: NodeJS.ProcessEnv;
  readonly services: Map<string, string>;
  readonly cli: (argv: readonly string[], timeoutMs?: number) => Effect.Effect<TimedRun, PerfError, FileSystem.FileSystem>;
}
export type BenchStep = (context: BenchContext) => Effect.Effect<unknown, PerfError, Scope.Scope | FileSystem.FileSystem>;
export interface HttpRequest {
  readonly path: string;
  readonly body?: (context: BenchContext) => unknown;
  readonly delayMs?: number;
}
export interface RequestSpec extends HttpRequest { readonly companions?: readonly HttpRequest[] }
export type BenchRun = readonly string[] | { readonly argv: readonly string[]; readonly concurrency: number }
  | { readonly request: RequestSpec } | { readonly scan: readonly string[] } | { readonly mod: 'first-screen' | 'push' };
export interface BenchScenario {
  readonly id: string; readonly consumer: 'self' | 'scale' | `fixture:${string}`;
  readonly server?: 'running';
  readonly env?: NodeJS.ProcessEnv;
  readonly state: 'warm' | 'cold'; readonly prepare?: BenchStep; readonly beforeEach?: BenchStep;
  readonly run: BenchRun;
  readonly expect: { readonly exitCode: number; readonly json?: Schema.ConstraintDecoder<unknown, never> };
}
export interface Benchmarks { readonly featureId: string; readonly scenarios: readonly BenchScenario[] }
const Id = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u));
export function defineBenchmarks(featureId: string, scenarios: readonly BenchScenario[]): Benchmarks {
  for (const scenario of scenarios) {
    Schema.decodeUnknownSync(Id)(scenario.id);
    if (!scenario.id.startsWith(`${featureId}/`)) throw new PerfError({ message: `Scenario ${scenario.id} must belong to ${featureId}` });
    if (!Array.isArray(scenario.run) && 'argv' in scenario.run
      && (!Number.isSafeInteger(scenario.run.concurrency) || scenario.run.concurrency < 1)) throw new PerfError({ message: `Invalid concurrency: ${scenario.id}` });
  }
  return { featureId, scenarios };
}
export const loadScenarios = Effect.fn('perf.loadScenarios')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const files = (yield* fs.readDirectory(join(root, 'bench'))).filter(name => name.endsWith('.bench.ts')).sort();
  const result: BenchScenario[] = [];
  for (const name of files) {
    const module = yield* Effect.tryPromise({ try: () => import(pathToFileURL(join(root, 'bench', name)).href) as Promise<{ default: Benchmarks }>, catch: cause => new PerfError({ message: `Load ${name}: ${String(cause)}` }) });
    const definition = module.default;
    if (definition.featureId !== basename(name, '.bench.ts')) return yield* new PerfError({ message: `Benchmark filename mismatch: ${name}` });
    result.push(...definition.scenarios);
  }
  if (new Set(result.map(item => item.id)).size !== result.length) return yield* new PerfError({ message: 'Duplicate scenario ID' });
  return result;
});
export function runArguments(run: BenchRun): readonly string[] {
  if ('argv' in run) return run.argv;
  if ('scan' in run) return run.scan;
  if ('request' in run) return ['view'];
  if ('mod' in run) return ['herdr'];
  return run;
}
// Source smoke tests still need a loader when a measured scenario clears NODE_OPTIONS.
const nodeEntry = (entry: string) => [process.execPath, ...(entry.endsWith('.ts') ? ['--import', import.meta.resolve('tsx')] : []), entry];
export const cliCommand = (artifact: Artifact, root: string, argv: readonly string[]) => (argv[0] === 'repo' || argv.includes('--skill') || argv.includes('--help') || argv.includes('--version'))
  ? [...nodeEntry(artifact.entry), ...argv] : [...nodeEntry(artifact.entry), '--root', root, ...argv];
export const makeContext = (artifact: Artifact, consumer: Consumer, outputDir: string, smoke = false, env?: NodeJS.ProcessEnv, refreshLimitMs = 0): BenchContext => ({
  artifact, consumer, outputDir, smoke, refreshLimitMs, services: new Map(), ...(env ? { env } : {}),
  cli: (argv, timeoutMs) => timedRun(cliCommand(artifact, consumer.root, argv), { cwd: consumer.root, outputDir, ...(env ? { env } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
});
export const prepareServer = Effect.fn('perf.prepareServer')(function*(context: BenchContext) {
  if (context.services.has('workspace-server')) return;
  const started = yield* context.cli(['server', 'start']);
  if (started.exitCode !== 0) return yield* new PerfError({ message: `Workspace service failed to start: ${started.stderr || started.stdout}` });
  context.services.set('workspace-server', 'running');
  yield* Effect.addFinalizer(() => context.cli(['server', 'stop']).pipe(Effect.ignore, Effect.ensuring(Effect.sync(() => { context.services.delete('workspace-server'); }))));
  yield* waitForProjection(context, ['workspace', 'projection'], 60_000);
});
export const Published = Schema.Struct({ projection: Schema.Struct({ current: Schema.Literal(false), builtAt: Schema.String }) });
export const waitForProjection = Effect.fn('perf.waitForProjection')(function*(context: BenchContext, argv: readonly string[], deadlineMs = context.refreshLimitMs + 30_000) {
  let last = '';
  return yield* Effect.gen(function*() {
    for (;;) {
      const attempt = yield* context.cli(['--json', ...argv]); last = attempt.stdout || attempt.stderr || last;
      if (attempt.exitCode === 0 && Schema.decodeUnknownExit(Schema.fromJsonString(Published), { onExcessProperty: 'ignore' })(attempt.stdout)._tag === 'Success') return;
      yield* Effect.sleep('100 millis');
    }
  }).pipe(Effect.timeoutOrElse({ duration: deadlineMs, orElse: () => Effect.fail(new PerfError({ message: `No published snapshot within ${deadlineMs}ms; last QueryPending/refresh: ${last}` })) }));
});
export const checkExpectation = Effect.fn('perf.checkExpectation')(function*(scenario: BenchScenario, run: TimedRun) {
  if (run.exitCode !== scenario.expect.exitCode) return yield* new PerfError({ message: `${scenario.id} exited ${run.exitCode ?? run.signal}, expected ${scenario.expect.exitCode}: ${run.stderr || run.stdout}` });
  if (scenario.expect.json) yield* io(`Decode ${scenario.id} output`, () => Schema.decodeUnknownSync(Schema.fromJsonString(scenario.expect.json!), { onExcessProperty: 'error' })(run.stdout));
});
const ScanMessage = Schema.Union([
  Schema.Struct({ format: Schema.Literal('concord.query-scan/v1'), ok: Schema.Literal(true), scannedAt: Schema.Number, finishedAt: Schema.Number,
    value: Schema.Json, complete: Schema.Boolean, unknown: Schema.Array(Schema.Literal('code')),
    drift: Schema.Struct({ files: Schema.Array(Schema.String), directories: Schema.Array(Schema.String), publicationChanged: Schema.Boolean }) }),
  Schema.Struct({ format: Schema.Literal('concord.query-scan/v1'), ok: Schema.Literal(false), scannedAt: Schema.Number, code: Schema.String, message: Schema.String, details: Schema.optionalKey(Schema.Json) }),
]);
export const executeScenario = Effect.fn('perf.executeScenario')(function*(scenario: BenchScenario, context: BenchContext, timeoutMs?: number) {
  const fs = yield* FileSystem.FileSystem;
  const run = scenario.run;
  if (scenario.state === 'cold') {
    const clear = yield* context.cli(['cache', 'clear']);
    if (clear.exitCode !== 0) return yield* new PerfError({ message: `Cache clear failed: ${clear.stderr || clear.stdout}` });
  }
  if (scenario.beforeEach) {
    if (context.consumer.kind === 'path') {
      yield* scenario.beforeEach(context);
      const status = yield* mustRun(['git', 'status', '--porcelain'], { cwd: context.consumer.root, outputDir: context.outputDir });
      if (status.stdout.trim()) return yield* new PerfError({ message: 'beforeEach changed a path consumer; preserve its edits and measure a frozen clone instead' });
    } else {
      const tracked = (yield* mustRun(['git', 'ls-files', '-z'], { cwd: context.consumer.root, outputDir: context.outputDir })).stdout.split('\0').filter(Boolean);
      const originals = new Map<string, { bytes: Uint8Array; mode: number }>();
      for (const path of tracked) {
        const absolute = join(context.consumer.root, path);
        const info = yield* fs.stat(absolute);
        if (info.type !== 'File' || (yield* Effect.result(fs.readLink(absolute)))._tag === 'Success') return yield* new PerfError({ message: `beforeEach requires regular source files: ${path}` });
        originals.set(path, { bytes: yield* fs.readFile(absolute), mode: info.mode & 0o777 });
      }
      yield* Effect.addFinalizer(() => Effect.gen(function*() {
        const untracked = (yield* mustRun(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: context.consumer.root, outputDir: context.outputDir })).stdout.split('\0').filter(Boolean);
        for (const [path, { bytes, mode }] of originals) {
          const absolute = join(context.consumer.root, path);
          const exists = yield* fs.exists(absolute);
          if ((yield* Effect.result(fs.readLink(absolute)))._tag === 'Success' || (exists && (yield* fs.stat(absolute)).type !== 'File')) return yield* new PerfError({ message: `Unsafe beforeEach replacement: ${path}` });
          if (!exists || !Buffer.from(yield* fs.readFile(absolute)).equals(bytes)) {
            yield* fs.makeDirectory(dirname(absolute), { recursive: true });
            yield* fs.writeFile(absolute, bytes);
          }
          if (((yield* fs.stat(absolute)).mode & 0o777) !== mode) yield* fs.chmod(absolute, mode);
        }
        for (const path of untracked) yield* fs.remove(join(context.consumer.root, path), { force: true });
      }).pipe(Effect.orDie));
      yield* scenario.beforeEach(context);
    }
  }
  let result: TimedRun;
  if ('mod' in run) {
    const captured = yield* timedRun([process.execPath, '--import', 'tsx', 'scripts/herdr-mod-host.ts', context.artifact.entry, context.consumer.root, run.mod], { cwd: process.cwd(), outputDir: context.outputDir, ...(timeoutMs ? { timeoutMs } : {}) });
    yield* checkExpectation(scenario, captured);
    const timing = yield* io('Decode readable mod description measurement', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ms: Schema.Number, startedAtMs: Schema.Number, endedAtMs: Schema.Number })), { onExcessProperty: 'ignore' })(captured.stdout));
    result = { ...captured, ...timing };
  } else if ('request' in run) {
    const address = context.services.get('view');
    if (!address) return yield* new PerfError({ message: 'prepare must start view' });
    const invoke = Effect.fn('perf.request')(function*(request: HttpRequest) {
      const body = request.body?.(context);
      if (request.delayMs) yield* Effect.sleep(request.delayMs);
      return yield* Effect.tryPromise({ try: async signal => {
        const started = performance.now();
        const response = await fetch(new URL(request.path, address), { signal,
          ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
        const stdout = await response.text();
        return { stdout, exitCode: response.ok ? 0 : response.status, ms: performance.now() - started, startedAtMs: started, endedAtMs: performance.now(), signal: null, stderr: '' };
      }, catch: cause => new PerfError({ message: `Request ${scenario.id}: ${String(cause)}` }) }).pipe(
        Effect.timeoutOrElse({ duration: timeoutMs ?? 60_000, orElse: () => Effect.fail(new PerfError({ message: `Request ${scenario.id} timed out` })) }),
      );
    });
    const [target, ...companions] = yield* Effect.all([invoke(run.request), ...(run.request.companions ?? []).map(request => invoke(request))], { concurrency: 'unbounded' });
    for (const companion of companions) {
      if (companion.exitCode !== 0) return yield* new PerfError({ message: `Competing request failed: ${companion.stdout}` });
      yield* io('Decode competing request', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json })), { onExcessProperty: 'error' })(companion.stdout));
    }
    result = target!;
  } else {
    const argv = 'scan' in run ? [...nodeEntry(((yield* fs.exists(installationResources(installationRootForBin(context.artifact.entry)).worker('query-scan-worker'))) ? installationResources(installationRootForBin(context.artifact.entry)).worker('query-scan-worker') : join(dirname(context.artifact.entry), 'query-scan-worker.js'))), context.consumer.root, JSON.stringify(run.scan)]
      : cliCommand(context.artifact, context.consumer.root, runArguments(run));
    const count = 'argv' in run ? run.concurrency : 1;
    const results = yield* Effect.all(Array.from({ length: count }, () => timedRun(argv, { cwd: context.consumer.root, outputDir: context.outputDir,
      ...(timeoutMs === undefined ? {} : { timeoutMs }), env: { ...context.env, ...scenario.env } })), { concurrency: 'unbounded' });
    for (const item of results) {
      yield* checkExpectation(scenario, item);
      if ('scan' in run) {
        const decoded = yield* io('Decode scan result', () => Schema.decodeUnknownSync(Schema.fromJsonString(ScanMessage), { onExcessProperty: 'error' })(item.stdout));
        if (!decoded.ok) return yield* new PerfError({ message: `Scan failed: ${item.stdout}` });
      }
    }
    result = count === 1 ? results[0]! : { ...results[0]!, ms: Math.max(...results.map(item => item.endedAtMs)) - Math.min(...results.map(item => item.startedAtMs)) };
  }
  yield* checkExpectation(scenario, result);
  return result;
}, Effect.scoped);
