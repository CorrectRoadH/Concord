// @concord-file
// @concord-implements docs/engineering/testing/README.md#分层
import type { Reporter } from 'e2e';
import { NodeServices } from '@effect/platform-node';
import { Effect, FileSystem } from 'effect';
import { dirname, join } from 'node:path';

/** The official attempt records include retries; a file span cannot replace their sum. */
export function summarizeBrowserAttempts(results: readonly {
  selected: boolean; kind: string; file: string; status: string; attempts: readonly { durationMs: number }[];
}[]) {
  const files = new Map<string, { file: string; duration_ms: number; cases: number; success: boolean; metric: 'browser-attempt-sum'; unknownAttempts: number }>();
  for (const result of results) {
    if (!result.selected || result.kind !== 'test') continue;
    const row = files.get(result.file) ?? { file: result.file, duration_ms: 0, cases: 0, success: true, metric: 'browser-attempt-sum', unknownAttempts: 0 };
    if (result.attempts.length === 0) row.unknownAttempts++;
    row.duration_ms += result.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0);
    row.cases++;
    row.success &&= result.status === 'passed';
    files.set(result.file, row);
  }
  return [...files.values()];
}

/** Consume the official completed-run document without replacing runner diagnostics. */
export const browserTestReport: Reporter = {
  name: 'concord-layer-timings',
  async onRunFinished({ report, reportPath }) {
    if (reportPath === undefined) return;
    const outputDir = dirname(reportPath);
    const files = summarizeBrowserAttempts(report.run.results);
    await Effect.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory(outputDir, { recursive: true });
      yield* fs.writeFileString(join(outputDir, 'file-timings.json'), `${JSON.stringify(files, null, 2)}\n`);
      yield* fs.writeFileString(join(outputDir, 'selected-files.json'), `${JSON.stringify(files.map(row => row.file), null, 2)}\n`);
    }).pipe(Effect.provide(NodeServices.layer)));
  },
};
