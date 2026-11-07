// @concord-file
// @concord-implements docs/engineering/testing/README.md#打包测试
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { observeTestProcessTree } from './gate-resource-processes.ts';
import { gateMemoryBudgets } from './gate-resources.ts';
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
export const preparePackagingFixture = Effect.fn('gate.preparePackagingFixture')(function*(root: string, report: string) {
  const started = performance.now();
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  let memory: unknown = null;
  const outcome = yield* Effect.result(Effect.gen(function*() {
    const cache = yield* prepareGateBuildCache(root);
    return yield* cache.build(output => Effect.scoped(Effect.gen(function*() {
      const observation = yield* observeTestProcessTree('build', gateMemoryBudgets.fixed);
      const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['exec', 'vp', 'build', '--outDir', output], {
      env: { ...process.env }, cwd: root, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: '5 seconds',
      }));
      memory = yield* observation.finish;
      return Number(code);
    })));
  }));
  const result: PackagePreparation = outcome._tag === 'Success'
    ? { state: 'ready', code: 0, packageRoot: outcome.success.packageRoot, digest: outcome.success.digest,
      cache: outcome.success.cache, memory, duration_ms: performance.now() - started }
    : { state: 'failed', code: 1, message: String(outcome.failure), memory, duration_ms: performance.now() - started };
  yield* writePackagePreparation(report, result);
  yield* Effect.sync(() => console.error(`# Archive preparation: ${(result.duration_ms / 1000).toFixed(3)}s; ${result.state}${result.state === 'ready' ? `; cache=${result.cache}; digest=${result.digest}` : `; ${result.message}`}`));
  return result;
});

export const waitForPackagePreparation = Effect.fn('gate.waitForPackagePreparation')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  for (;;) {
    const receipt = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Receipt), { onExcessProperty: 'error' })(yield* fs.readFileString(path));
    if (receipt.state !== 'pending') return receipt;
    yield* Effect.sleep('25 millis');
  }
});
