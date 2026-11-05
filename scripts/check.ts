import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join } from 'node:path';
import { checkoutRoot } from './build-output.js';

class DistInCheckout extends Schema.TaggedError<DistInCheckout>()('DistInCheckout', { message: Schema.String }) {}

const task = Effect.fn('check.task')(function* (name: string, args: readonly string[] = []) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner.exitCode(ChildProcess.make('pnpm', ['exec', 'vp', 'run', name, ...args], { stdout: 'inherit', stderr: 'inherit' }));
  return Number(code);
}, Effect.catch(cause => Effect.sync(() => { console.error(String(cause)); return 1; })));

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(join(checkoutRoot, 'dist'))) return yield* new DistInCheckout({ message: 'Delete dist/ from the checkout before running pnpm check. Tests run source; build packages with vp build --outDir <external-directory>.' });
  const compileCache = yield* fs.makeTempDirectoryScoped({ directory: process.env.XDG_RUNTIME_DIR, prefix: 'concord-check-compile-' });
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
  const names = ['check:source', 'check:tests', 'check:scripts', 'check:web', 'check:selfhost', 'test:source'];
  // Vite+ dependencies stop on failure; acceptance must finish every sibling.
  const codes = yield* Effect.forEach(names, name => task(name, name === 'test:source' ? process.argv.slice(2) : []), { concurrency: 'unbounded' });
  yield* Effect.sync(() => {
    console.error(`# Check total: ${((performance.now() - started) / 1000).toFixed(3)}s`);
    console.error(`# Check results: ${names.map((name, index) => `${name}=${codes[index]}`).join(', ')}`);
    process.exitCode = codes.every(code => code === 0) ? 0 : 1;
  });
});

main.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
