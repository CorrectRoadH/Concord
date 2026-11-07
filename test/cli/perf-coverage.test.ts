import { describe } from 'node:test';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkCliSmoke } from '../support/benchmark-cli-smoke.ts';

// Each case still executes its original frozen scenarios and expectations.
describe('ordinary CLI benchmark smoke', { concurrency: 1 }, () => {
  // @feature docs/feature/documentation-quality/README.md
  test('documentation-quality ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('documentation-quality').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/feedback/README.md
  test('feedback ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('feedback').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/local-sdlc/README.md
  test('local-sdlc-checks ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('local-sdlc', [2, 3]).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/local-sdlc/README.md
  test('local-sdlc-reads ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('local-sdlc', [0, 1]).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/local-sdlc/README.md
  test('local-sdlc-tools ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('local-sdlc', [4]).pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/project-onboarding/README.md
  test('project-onboarding ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('project-onboarding').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));

  // @feature docs/feature/taste/README.md
  test('taste ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
    Effect.runPromise(benchmarkCliSmoke('taste').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
});
