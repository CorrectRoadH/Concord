import type { Scope } from 'effect';
import { bench } from 'mitata';
import { executeQuery } from '../src/app/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // A real taste entry and forty Feature references, including source safety and repository release.
  bench('taste/entries', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const reply = await fixture.runtime.runPromise(executeQuery(fixture.root, { name: 'taste', input: {} }));
      if (reply.exitCode !== 0) throw new Error(JSON.stringify(reply.value));
      return reply.value;
    };
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
