import { Effect } from 'effect';
import { io, mustRun } from './perf/process.ts';
import { prepareGateBuildCache } from './gate-build-cache.ts';

/** Measurements retain a lease on the immutable compiled CLI archive. */
export const buildForMeasurement = Effect.fn('perf.buildForMeasurement')(function*(root: string, outputDir: string) {
  const cached = yield* prepareGateBuildCache(root);
  const result = yield* cached.build(output => Effect.gen(function*() {
    const built = yield* mustRun(['pnpm', 'exec', 'vp', 'build', '--outDir', output], { cwd: root, outputDir });
    yield* io('Report candidate build', () => process.stderr.write(built.stdout + built.stderr));
    return 0;
  }));
  yield* io('Report candidate cache', () => process.stderr.write(`Build cache ${result.cache}: ${result.digest}\n`));
  return result.packageRoot;
});
