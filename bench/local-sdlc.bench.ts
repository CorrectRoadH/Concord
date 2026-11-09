import type { Scope } from 'effect';
import { bench } from 'mitata';
import { executeQuery, type QueryRequest } from '../src/app/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Each operation has a private frozen representative repository and prefilled application caches.
  const queries = [
    ['documents-list', { name: 'documents.list', input: {} }],
    ['memory-search', { name: 'memory.search', input: { query: 'Snapshot' } }],
    ['trace-check', { name: 'trace.check', input: {} }],
    ['check', { name: 'check', input: {} }],
    ['code-list', { name: 'code.list', input: {} }],
    ['test-list', { name: 'test.list', input: {} }],
  ] satisfies readonly (readonly [string, QueryRequest])[];
  for (const [name, query] of queries) bench(`local-sdlc/${name}`, async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const result = await fixture.runtime.runPromise(executeQuery(fixture.root, query));
      if (result.exitCode !== 0) throw new Error(JSON.stringify(result.value));
      return result.value;
    };
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
