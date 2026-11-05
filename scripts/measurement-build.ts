import { Effect } from 'effect';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from './test-temporary.js';
import { io, mustRun } from './perf/process.js';

/** Every measurement owns a complete candidate outside the source checkout. */
export const buildForMeasurement = Effect.fn('perf.buildForMeasurement')(function*(root: string, outputDir: string) {
  const output = yield* Effect.acquireRelease(io('Create candidate output', () => mkdtempSync(join(tmpdir(), 'concord-bench-package-'))), path => Effect.sync(() => rmSync(path, { recursive: true, force: true })));
  const built = yield* mustRun(['pnpm', 'exec', 'vp', 'build', '--outDir', output], { cwd: root, outputDir });
  yield* io('Report candidate build', () => process.stderr.write(built.stdout + built.stderr));
  yield* mustRun(['pnpm', 'install', '--prod', '--frozen-lockfile', '--ignore-scripts', '--offline'], { cwd: output, outputDir });
  return output;
});
