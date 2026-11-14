import type { Scope } from 'effect';
import { bench } from 'mitata';
import { executeQuery, type QueryRequest } from '../src/app/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { knowledgeSearchFixture } from './fixtures/knowledge-search.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Each operation has a private frozen representative repository and prefilled application caches.
  const queries = [
    ['documents-list', { name: 'documents.list', input: {} }],
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

  for (const kind of ['memory', 'issue'] as const) {
    for (const size of [100, 1000, 10000]) {
      for (const hits of ['zero', 'rare', 'high'] as const) {
        bench(`local-sdlc/search/${kind}/scan/${size}/${hits}`, async function*() {
          const fixture = await knowledgeSearchFixture(scope, kind, size, 'memory');
          yield () => fixture.scan(hits);
          await fixture.close();
        });
      }
      for (const storage of ['persistent', 'memory'] as const) {
        for (const hits of ['zero', 'rare', 'high'] as const) {
          bench(`local-sdlc/search/${kind}/${storage}/${size}/warm/${hits}`, async function*() {
            const fixture = await knowledgeSearchFixture(scope, kind, size, storage);
            yield () => fixture.warm(hits);
            await fixture.close();
          });
          bench(`local-sdlc/search/${kind}/${storage}/${size}/cold/${hits}`, async function*() {
            const fixture = await knowledgeSearchFixture(scope, kind, size, storage);
            // Mitata computes independent parameters outside timing, including any batched parameters.
            yield {
              0: () => fixture.prepare('cold'),
              bench: (session: Awaited<ReturnType<typeof fixture.prepare>>) => fixture.query(session, 'cold', hits),
            };
            await fixture.close();
          });
        }
        bench(`local-sdlc/search/${kind}/${storage}/${size}/change/rare`, async function*() {
          const fixture = await knowledgeSearchFixture(scope, kind, size, storage);
          yield {
            0: () => fixture.prepare('change'),
            bench: (session: Awaited<ReturnType<typeof fixture.prepare>>) => fixture.query(session, 'change', 'rare'),
          };
          await fixture.close();
        });
        if (size !== 1000) continue;
        bench(`local-sdlc/search/${kind}/${storage}/${size}/warm/no-gram`, async function*() {
          const fixture = await knowledgeSearchFixture(scope, kind, size, storage);
          yield () => fixture.warm('no-gram');
          await fixture.close();
        });
        for (const state of storage === 'persistent' ? ['reopen', 'clear'] as const : ['reopen'] as const) {
          bench(`local-sdlc/search/${kind}/${storage}/${size}/${state}/rare`, async function*() {
            const fixture = await knowledgeSearchFixture(scope, kind, size, storage);
            yield {
              0: () => fixture.prepare(state),
              bench: (session: Awaited<ReturnType<typeof fixture.prepare>>) => fixture.query(session, state, 'rare'),
            };
            await fixture.close();
          });
        }
      }
    }
  }
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
