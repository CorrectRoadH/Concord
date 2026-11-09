import type { Scope } from 'effect';
import { bench } from 'mitata';
import { executeQuery } from '../src/app/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Ten local Issues carry captured remote metadata; listing never contacts a provider.
  bench('feedback/list', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const reply = await fixture.runtime.runPromise(executeQuery(fixture.root, { name: 'feedback.list', input: {} }));
      if (reply.exitCode !== 0) throw new Error(JSON.stringify(reply.value));
      return reply.value;
    };
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
