import { Effect, type Scope } from 'effect';
import { bench } from 'mitata';
import { cacheStatus, scanQueryProcess } from '../src/app/index.ts';
import { Workspace } from '../src/base/workspace/index.ts';
import { failure } from '../src/model/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Current-source scan bypasses query projections; OS/process caches may be warm.
  bench('local-data-engine/source-scan', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const result = await fixture.runtime.runPromise(scanQueryProcess(fixture.root, '["trace","gaps"]'));
      if (!result.ok || !result.complete) throw new Error(JSON.stringify(result));
      return result;
    };
    await fixture.close();
  });
  bench('local-data-engine/cache-status', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => fixture.runtime.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(fixture.root, { access: 'read' });
      const result = yield* Effect.try({ try: () => cacheStatus(repo), catch: failure });
      if (result.status !== 'ready') throw new Error(JSON.stringify(result));
      return result;
    })));
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
