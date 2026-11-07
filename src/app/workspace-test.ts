// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
import { Effect } from 'effect';
import { Workspace } from '../base/workspace/index.ts';
import { buildTrace, requireValidTrace, selectCase } from '../domain/trace/index.ts';
import { runCase } from '../domain/tests/index.ts';
import { failure } from '../model/index.ts';

export const runWorkspaceTest = Effect.fn('runWorkspaceTest')(function*(root: string, caseId: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const repo = yield* (yield* Workspace).openWrite(root);
    const trace = yield* Effect.tryPromise({ try: async () => (await repo.snapshot(async () => (await buildTrace(repo, 'off', { includeCode: false })))), catch: failure }).pipe(Effect.uninterruptible);
    yield* Effect.try({ try: () => requireValidTrace(trace), catch: failure });
    const selected = yield* Effect.try({ try: () => selectCase(trace.annotations.cases, caseId), catch: failure });
    return yield* runCase(repo, selected, trace.documents);
  }));
});
