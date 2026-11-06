import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { benchmarkCliSmoke } from '../support/benchmark-cli-smoke.ts';

// @feature docs/feature/local-sdlc/README.md
test('feedback ordinary benchmark scenarios execute on minimal frozen consumers without timing verdicts', { timeout: 180_000 }, t =>
  Effect.runPromise(benchmarkCliSmoke('feedback').pipe(Effect.scoped, Effect.provide(NodeServices.layer)), { signal: t.signal }));
