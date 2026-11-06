import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkSmoke } from '../support/benchmark-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('feedback ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkSmoke(false, 'feedback').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
