import type { Scope } from 'effect';
import { bench } from 'mitata';
import { executeQuery } from '../src/app/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Real writing policy, catalog and linked prose; warm application caches, operation-owned reads.
  bench('documentation-quality/writing-check', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const reply = await fixture.runtime.runPromise(executeQuery(fixture.root, { name: 'docs.check', input: {} }));
      if (reply.exitCode !== 0) throw new Error(JSON.stringify(reply.value));
      return reply.value;
    };
    await fixture.close();
  });
  bench('documentation-quality/concepts-index', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const reply = await fixture.runtime.runPromise(executeQuery(fixture.root, { name: 'concepts.index', input: {} }));
      if (reply.exitCode !== 0) throw new Error(JSON.stringify(reply.value));
      return reply.value;
    };
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
