// @concord-file
// @concord-implements docs/engineering/build/architecture.md#脚本只写项目特有的规则
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Duration, Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join } from 'node:path';
import { checkoutRoot } from './build-output.js';
import { withGateResources } from './gate-resources.js';
import { selectGateTests } from './gate-selection.js';

class DistInCheckout extends Schema.TaggedError<DistInCheckout>()('DistInCheckout', { message: Schema.String }) {}

const task = Effect.fn('gate.task')(function* (name: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = process.env) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['exec', 'vp', ...(name === 'build' ? ['build'] : ['run', name]), ...args], {
    env: { ...env, CONCORD_GATE_TEST_OUTPUT: name === 'test:source' ? process.env.CONCORD_GATE_REPORT : undefined },
    stdin: 'ignore', stdout: 'inherit', stderr: 'inherit', forceKillAfter: Duration.seconds(5),
  }));
  return Number(code);
}, Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return 1; })));

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(join(checkoutRoot, 'dist'))) return yield* new DistInCheckout({ message: 'Delete dist/ from the checkout before running pnpm gate. Tests run source; build packages with vp build --outDir <external-directory>.' });
  const selected = yield* selectGateTests(process.argv.slice(2), checkoutRoot, process.env.CONCORD_GATE_REPORT);
  const compileCache = yield* fs.makeTempDirectoryScoped({ directory: process.env.XDG_RUNTIME_DIR, prefix: 'concord-gate-compile-' });
  const packageDirectory = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-gate-package-' });
  // Keep fixture fsync traffic off the checkout disk. tmpfs pages are charged
  // to this gate's memory scope, and the same scope owns their removal.
  const fixtureDirectory = yield* (process.platform === 'linux' && (yield* fs.exists('/dev/shm'))
    ? fs.makeTempDirectoryScoped({ directory: '/dev/shm', prefix: 'concord-gate-tests-' }).pipe(
      Effect.catch(() => fs.makeTempDirectoryScoped({ prefix: 'concord-gate-tests-' })),
    )
    : fs.makeTempDirectoryScoped({ prefix: 'concord-gate-tests-' }));
  const packageRoot = join(packageDirectory, 'package');
  const buildStatus = join(packageDirectory, 'build-status.json');
  yield* Effect.acquireRelease(Effect.sync(() => {
    const previous = { cache: process.env.NODE_COMPILE_CACHE, owner: process.env.CONCORD_TEST_COMPILE_CACHE };
    process.env.NODE_COMPILE_CACHE = compileCache;
    process.env.CONCORD_TEST_COMPILE_CACHE = compileCache;
    return previous;
  }), previous => Effect.sync(() => {
    if (previous.cache === undefined) delete process.env.NODE_COMPILE_CACHE;
    else process.env.NODE_COMPILE_CACHE = previous.cache;
    if (previous.owner === undefined) delete process.env.CONCORD_TEST_COMPILE_CACHE;
    else process.env.CONCORD_TEST_COMPILE_CACHE = previous.owner;
  }));
  const started = performance.now();
  const env = { ...process.env, CONCORD_TEST_PACKAGE_ROOT: packageRoot, CONCORD_TEST_PACKAGE_BUILD_STATUS: buildStatus,
    TMPDIR: fixtureDirectory, TMP: fixtureDirectory, TEMP: fixtureDirectory,
    CONCORD_GATE_TEST_FILES: JSON.stringify(selected.files), CONCORD_GATE_ALL_TEST_FILES: JSON.stringify(selected.allFiles) };
  const build = Effect.gen(function*() {
    const code = yield* Effect.gen(function*() {
      const code = yield* task('build', ['--outDir', packageRoot], env);
      if (code === 0) yield* fs.symlink(join(checkoutRoot, 'node_modules'), join(packageRoot, 'node_modules'));
      return code;
    }).pipe(Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return 1; })));
    yield* fs.writeFileString(`${buildStatus}.pending`, JSON.stringify({ code }));
    yield* fs.rename(`${buildStatus}.pending`, buildStatus);
    return code;
  });
  const names = ['gate:source', 'gate:tests', 'gate:scripts', 'gate:web', 'gate:selfhost', 'test:source', 'build'];
  // Vite+ dependencies stop on failure; acceptance must finish every sibling.
  yield* Effect.sync(() => console.error(`# Gate package: ${packageRoot}; builds=1; lifetime=gate`));
  yield* Effect.sync(() => console.error(`# Gate fixture directory: ${fixtureDirectory}; lifetime=gate; included in memory scope`));
  const codes = yield* Effect.all([
    ...names.slice(0, -1).map(name => task(name, name === 'test:source' ? selected.args : [], name === 'test:source' ? env : process.env)),
    build,
  ], { concurrency: 'unbounded' });
  yield* Effect.sync(() => {
    console.error(`# Gate total: ${((performance.now() - started) / 1000).toFixed(3)}s`);
    console.error(`# Gate results: ${names.map((name, index) => `${name}=${codes[index]}`).join(', ')}`);
    process.exitCode = codes.every(code => code === 0) ? 0 : 1;
  });
});

withGateResources(main).pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
