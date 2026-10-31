// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md#约束
import { Effect } from 'effect';
import { Sources, type ReportBudget as SourceReportBudget } from '../../base/sources/index.js';
import { ConcordError, type test_adapter_config_TestAdapter as TestAdapter } from '../../model/index.js';

export function reportPath(path: string): string {
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ConcordError('ReportUnsafe', `Report path must stay inside its allocated invocation directory: ${path}`);
  return path;
}
export type ReportBudget = SourceReportBudget;
export const readReports = Effect.fn('Tests.readReports')(function*(directory: string, declared: readonly string[], adapter: TestAdapter, budget: ReportBudget) {
  if (new Set(declared).size !== declared.length) return yield* Effect.fail(new ConcordError('ReportUnsafe', 'Repeated report paths'));
  yield* Effect.try({ try: () => declared.forEach(reportPath), catch: cause => cause instanceof ConcordError ? cause : new ConcordError('ReportUnsafe', String(cause)) });
  return yield* (yield* Sources).readReportFiles(directory, declared, adapter.budgets ?? {}, budget, text => {
    if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(text)) throw new ConcordError('ReportUnsafe', 'DTD and XML entities are forbidden');
  });
});
