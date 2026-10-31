import test from 'node:test';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.js';

// @feature docs/feature/local-sdlc/README.md
test('all service benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(true).pipe(Effect.scoped), { signal: t.signal }));
