// @concord-file
// @concord-implements docs/engineering/testing/README.md#分层
import type { Reporter } from 'e2e';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { dirname, join } from 'node:path';

/** Consume the official completed-run document without replacing runner diagnostics. */
export const browserTestReport: Reporter = {
  name: 'concord-layer-timings',
  async onRunFinished({ report, reportPath }) {
    if (reportPath === undefined) return;
    const outputDir = dirname(reportPath);
    const files = new Map<string, { file: string; duration_ms: number; cases: number; success: boolean }>();
    for (const result of report.run.results) {
      if (!result.selected || result.kind !== 'test' || result.attempts.length === 0) continue;
      const row = files.get(result.file) ?? { file: result.file, duration_ms: 0, cases: 0, success: true };
      row.duration_ms += result.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
      row.cases++;
      row.success &&= result.status === 'passed';
      files.set(result.file, row);
    }
    await Effect.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(outputDir, { recursive: true });
      yield* fs.writeFileString(join(outputDir, 'file-timings.json'), `${JSON.stringify([...files.values()], null, 2)}\n`);
    }).pipe(Effect.provide(NodeServices.layer)));
  },
};
