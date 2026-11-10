// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Clock, Effect } from 'effect';
import type { ProcessGroupCpu } from '../../base/process/index.ts';
import { ConcordError } from '../../model/index.ts';

const watchProgress = Effect.fn('Computation.watchProgress')(function*(cpu: Effect.Effect<ProcessGroupCpu, unknown>, responses: () => number) {
  const started = yield* Clock.currentTimeMillis;
  let lastProgress = started;
  let previous = yield* cpu;
  let received = responses();
  while (true) {
    yield* Effect.sleep('5 seconds');
    const current = yield* cpu;
    const now = yield* Clock.currentTimeMillis;
    const elapsedMs = now - started;
    const response = responses();
    if (response !== received || [...current].some(([identity, ticks]) => ticks > (previous.get(identity) ?? 0))) lastProgress = now;
    if (now - lastProgress >= 60_000) return yield* Effect.fail(new ConcordError('ComputeUnresponsive', 'Computation made no response or CPU progress for sixty seconds', { elapsedMs, limitMs: 60_000 }));
    previous = current;
    received = response;
  }
});

export const watchComputation = Effect.fn('Computation.watch')(function*(cpu: Effect.Effect<ProcessGroupCpu, unknown>, responses: () => number) {
  const started = yield* Clock.currentTimeMillis;
  return yield* watchProgress(cpu, responses).pipe(Effect.timeoutOrElse({
    duration: '600 seconds',
    orElse: () => Clock.currentTimeMillis.pipe(Effect.flatMap(now => Effect.fail(new ConcordError('ComputeRequestTimedOut', 'Computation request exceeded its budget', { elapsedMs: now - started, limitMs: 600_000 })))),
  }));
});
