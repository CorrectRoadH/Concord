import { Effect, FileSystem } from 'effect';
import { tmpdir } from 'node:os';
import { io, mustRun } from './perf/process.js';

/** Every measurement owns a complete candidate outside the source checkout. */
export const buildForMeasurement = Effect.fn('perf.buildForMeasurement')(function*(root: string, outputDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* fs.makeTempDirectoryScoped({ directory: tmpdir(), prefix: 'concord-bench-package-' });
  const built = yield* mustRun(['pnpm', 'exec', 'vp', 'build', '--outDir', output], { cwd: root, outputDir });
  yield* io('Report candidate build', () => process.stderr.write(built.stdout + built.stderr));
  yield* mustRun(['pnpm', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--offline'], { cwd: output, outputDir });
  return output;
});
