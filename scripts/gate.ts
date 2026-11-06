// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Duration, Effect, Fiber, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join } from 'node:path';
import { checkoutRoot } from './build-output.ts';
import { withGateResources } from './gate-resources.ts';
import { selectGateTests } from './gate-selection.ts';
import { preparePackagingFixture, selectsPackagingTest, writePackagePreparation } from './gate-package.ts';
import { initializeNodeCompileCache } from '../src/base/installation/startup/index.ts';

class DistInCheckout extends Schema.TaggedError<DistInCheckout>()('DistInCheckout', { message: Schema.String }) {}

const task = Effect.fn('gate.task')(function* (name: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = process.env) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['exec', 'vp', 'run', name, ...args], {
    env: { ...env, CONCORD_GATE_TEST_OUTPUT: name === 'test:source' ? process.env.CONCORD_GATE_REPORT : undefined },
    stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: Duration.seconds(5),
  }));
  return Number(code);
}, Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return 1; })));

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(join(checkoutRoot, 'dist'))) return yield* new DistInCheckout({ message: 'Delete dist/ from the checkout before running pnpm gate. Tests run source; build packages with vp build --outDir <external-directory>.' });
  const selected = yield* selectGateTests(process.argv.slice(2), checkoutRoot, process.env.CONCORD_GATE_REPORT);
  const compileCache = yield* Effect.sync(initializeNodeCompileCache);
  // Keep fixture fsync traffic off the checkout disk. tmpfs pages are charged
  // to this gate's memory scope, and the same scope owns their removal.
  const fixtureDirectory = yield* (process.platform === 'linux' && (yield* fs.exists('/dev/shm'))
    ? fs.makeTempDirectoryScoped({ directory: '/dev/shm', prefix: 'concord-gate-tests-' }).pipe(
      Effect.catch(() => fs.makeTempDirectoryScoped({ prefix: 'concord-gate-tests-' })),
    )
    : fs.makeTempDirectoryScoped({ prefix: 'concord-gate-tests-' }));
  yield* Effect.sync(() => {
    process.env.CONCORD_TEST_COMPILE_CACHE = compileCache;
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --conditions=concord-source`.trim();
  });
  const started = performance.now();
  const preparationReport = join(process.env.CONCORD_GATE_REPORT!, 'archive-preparation.json');
  const packageSelected = yield* Effect.try({ try: () => selectsPackagingTest(selected.files, selected.args, checkoutRoot), catch: cause => cause });
  if (packageSelected) yield* writePackagePreparation(preparationReport, { state: 'pending' });
  const preparation = packageSelected
    ? yield* preparePackagingFixture(checkoutRoot, preparationReport).pipe(Effect.forkScoped)
    : undefined;
  const env = { ...process.env,
    TMPDIR: fixtureDirectory, TMP: fixtureDirectory, TEMP: fixtureDirectory,
    CONCORD_GATE_PACKAGE_PREPARATION: packageSelected ? preparationReport : undefined,
    CONCORD_GATE_TEST_FILES: JSON.stringify(selected.files), CONCORD_GATE_ALL_TEST_FILES: JSON.stringify(selected.allFiles) };
  const names = ['gate:source', 'gate:tests', 'gate:scripts', 'gate:web', 'gate:lint', 'gate:selfhost', 'test:source'];
  // Vite+ dependencies stop on failure; acceptance must finish every sibling.
  yield* Effect.sync(() => console.error(`# Node compile cache: ${compileCache}; lifetime=shared; test-results=uncached`));
  yield* Effect.sync(() => console.error(`# Gate fixture directory: ${fixtureDirectory}; lifetime=gate; included in memory scope`));
  const codes = yield* Effect.all(names.map(name => task(name, name === 'test:source' ? selected.args : [], name === 'test:source' ? env : process.env)), { concurrency: 'unbounded' });
  const packageCode = preparation === undefined ? 0 : (yield* Fiber.join(preparation)).code;
  yield* Effect.sync(() => {
    console.error(`# Gate total: ${((performance.now() - started) / 1000).toFixed(3)}s`);
    console.error(`# Gate results: ${names.map((name, index) => `${name}=${codes[index]}`).join(', ')}`);
    process.exitCode = packageCode === 0 && codes.every(code => code === 0) ? 0 : 1;
  });
});

withGateResources(main).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
