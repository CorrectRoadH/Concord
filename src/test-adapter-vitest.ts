// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// Runs only as an owned child process. Project modules never enter Concord's process.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { Effect, Schema } from 'effect';

const Arguments = Schema.Tuple([Schema.String, Schema.String, Schema.String]);
const program = Effect.gen(function* () {
  const [root, file, report] = yield* Effect.try(() => Schema.decodeUnknownSync(Arguments)(process.argv.slice(2)));
  const modulePath = yield* Effect.try(() => createRequire(join(root, 'package.json')).resolve('vitest/node'));
  const api = yield* Effect.tryPromise(() => import(pathToFileURL(modulePath).href) as Promise<typeof import('vitest/node')>);
  const ctx = yield* Effect.acquireRelease(
    Effect.tryPromise(() => api.createVitest('test', { root, watch: false, cache: false, reporters: [], includeTaskLocation: true })),
    ctx => Effect.promise(() => ctx.close()),
  );
  const specs = yield* Effect.tryPromise(() => ctx.globTestSpecifications([file]));
  const collected = yield* Effect.tryPromise(() => ctx.collectTests(specs));
  if (collected.unhandledErrors.length > 0 || process.exitCode) return yield* Effect.fail(new Error('Vitest collection failed'));
  const cases = collected.testModules.flatMap(module => [...module.children.allTests()].map(test => {
    const names = [test.name]; let parent = test.parent;
    while (parent.type !== 'module') { names.unshift(parent.name); parent = parent.parent; }
    return { name: names.join(' '), file: module.moduleId, project: test.project.name || 'default', skipped: test.result().state === 'skipped' };
  }));
  yield* Effect.sync(() => writeFileSync(report, JSON.stringify(cases), { flag: 'wx' }));
});
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await Effect.runPromise(program.pipe(Effect.scoped)).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
}
