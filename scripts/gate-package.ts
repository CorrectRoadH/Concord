// @concord-file
// @concord-implements docs/engineering/testing/README.md#打包测试
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect, FileSystem, Schema, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { observeTestProcessTree } from './gate-resource-processes.ts';
import { gateMemoryBudgets, withGateAdmission, type GateAdmission } from './gate-resources.ts';
import { prepareGateBuildCache } from './gate-build-cache.ts';

export const packagingTestFile = 'test/process/release-package.test.ts';
export const isPackagingTest = (file: string, root = process.cwd()): boolean => relative(resolve(root), resolve(file)).replaceAll('\\', '/') === packagingTestFile;
/** Matches Node's official file sharding before separating the packaging fixture. */
export const shardNodeFiles = (files: readonly string[], shard?: { index: number; total: number }): string[] =>
  files.filter((_, index) => shard === undefined || index % shard.total === shard.index - 1);

export const selectsPackagingTest = (files: readonly string[], args: readonly string[], root = process.cwd()): boolean => {
  const { values } = parseArgs({ args: [...args], allowPositionals: true, options: {
    suite: { type: 'string' }, 'test-shard': { type: 'string' }, 'test-name-pattern': { type: 'string' },
    'node-worker': { type: 'boolean' },
  } });
  if (values.suite === 'e2e' || values.suite === 'agent') return false;
  if (values['test-shard'] === 'package') return files.some(file => isPackagingTest(file, root));
  if (values['test-shard'] !== undefined) {
    const raw = Schema.decodeUnknownSync(Schema.String.check(Schema.isPattern(/^[1-9]\d*\/[1-9]\d*$/u)))(values['test-shard']);
    const [index, total] = raw.split('/').map(Number) as [number, number];
    if (index > total) throw new Error('Shard index exceeds the shard count');
    return false;
  }
  return files.some(file => isPackagingTest(file, root));
};

const Ready = Schema.Struct({ state: Schema.Literal('ready'), code: Schema.Literal(0), packageRoot: Schema.String,
  duration_ms: Schema.Number, memory: Schema.optional(Schema.Unknown), digest: Schema.String, cache: Schema.Literals(['hit', 'miss']) });
const Failed = Schema.Struct({ state: Schema.Literal('failed'), code: Schema.Literal(1), duration_ms: Schema.Number, memory: Schema.optional(Schema.Unknown), message: Schema.String });
const Preparation = Schema.Union([Ready, Failed]);
export type PackagePreparation = typeof Preparation.Type;
const Receipt = Schema.Union([Preparation, Schema.Struct({ state: Schema.Literal('pending') })]);

export const writePackagePreparation = Effect.fn('gate.writePackagePreparation')(function*(path: string, value: typeof Receipt.Type) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  yield* fs.writeFileString(temporary, `${JSON.stringify(value, null, 2)}\n`);
  yield* fs.rename(temporary, path);
});

/** The caller's scope owns the cache lease until every consuming suite exits. */
export const preparePackagingFixture = Effect.fn('gate.preparePackagingFixture')(function*(root: string, report: string, admission: GateAdmission) {
  const started = performance.now();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const leaseScope = yield* Scope.Scope;
  let memory: unknown = null;
  let completed = false;
  yield* Effect.addFinalizer(() => completed ? Effect.void : writePackagePreparation(report, { state: 'failed', code: 1,
    duration_ms: performance.now() - started, memory, message: 'Archive preparation interrupted before completion' }).pipe(Effect.orDie));
  const outcome = yield* Effect.result(Effect.scoped(Effect.gen(function*() {
    const observation = yield* observeTestProcessTree('archive-preparation', gateMemoryBudgets.archive, ['build', 'scripts/build-native.ts'], true);
    yield* Effect.addFinalizer(() => Effect.gen(function*() {
      memory = yield* observation.finish.pipe(Effect.onExit(exit => Effect.sync(() => { if (exit._tag === 'Failure') admission.failed = true; })));
    }).pipe(Effect.orDie));
    // The gate's test scope retains the cache lease after preparation releases
    // admission, until the last archive consumer has exited.
    const cache = yield* prepareGateBuildCache(root).pipe(Effect.provideService(Scope.Scope, leaseScope));
    return yield* cache.build(output => Effect.gen(function*() {
      const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['exec', 'vp', 'build', '--outDir', output], {
      env: { ...process.env }, cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: '5 seconds',
      }));
      return Number(code);
    }));
  })).pipe(withGateAdmission(admission, gateMemoryBudgets.archive, 'archive-preparation'))).pipe(
    Effect.onExit(exit => exit._tag === 'Failure' ? writePackagePreparation(report, { state: 'failed', code: 1,
      duration_ms: performance.now() - started, memory, message: 'Archive preparation interrupted or failed during cleanup' }).pipe(
      Effect.tap(() => Effect.sync(() => { completed = true; })), Effect.orDie,
    ) : Effect.void),
  );
  const result: PackagePreparation = outcome._tag === 'Success'
    ? { state: 'ready', code: 0, packageRoot: outcome.success.packageRoot, digest: outcome.success.digest,
      cache: outcome.success.cache, memory, duration_ms: performance.now() - started }
    : { state: 'failed', code: 1, message: String(outcome.failure), memory, duration_ms: performance.now() - started };
  yield* writePackagePreparation(report, result);
  completed = true;
  yield* Effect.sync(() => console.error(`# Archive preparation: ${(result.duration_ms / 1000).toFixed(3)}s; ${result.state}${result.state === 'ready' ? `; cache=${result.cache}; digest=${result.digest}` : `; ${result.message}`}`));
  return result;
});

export const waitForPackagePreparation = Effect.fn('gate.waitForPackagePreparation')(function*(path: string) {
  for (;;) {
    const receipt = yield* readPackagePreparation(path);
    if (receipt.state !== 'pending') return receipt;
    yield* Effect.sleep('25 millis');
  }
});

export const readPackagePreparation = Effect.fn('gate.readPackagePreparation')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Receipt), { onExcessProperty: 'error' })(yield* fs.readFileString(path));
});
