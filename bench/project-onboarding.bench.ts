import { Effect, type Scope } from 'effect';
import { bench } from 'mitata';
import { doctor, executeQuery } from '../src/app/index.ts';
import { Workspace } from '../src/base/workspace/index.ts';
import { failure } from '../src/model/index.ts';
import { repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Real static configuration; each invocation opens and releases its own repository.
  bench('project-onboarding/config-read', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const reply = await fixture.runtime.runPromise(executeQuery(fixture.root, { name: 'config.show', input: {} }));
      if (reply.exitCode !== 0) throw new Error(JSON.stringify(reply.value));
      return reply.value;
    };
    await fixture.close();
  });
  bench('project-onboarding/doctor', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => fixture.runtime.runPromise(Effect.scoped(Effect.gen(function*() {
      const repo = yield* (yield* Workspace).openRead(fixture.root, { access: 'read' });
      const result = yield* Effect.tryPromise({ try: () => doctor(repo, undefined, 'off'), catch: failure });
      if (!result.ok) throw new Error(JSON.stringify(result));
      return result;
    })));
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
