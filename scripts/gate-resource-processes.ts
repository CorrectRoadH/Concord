// @concord-file
// @concord-implements docs/engineering/testing/cli.md#并发
import { Effect, Schema } from 'effect';
import { channel } from 'node:diagnostics_channel';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class GateProcessCleanupFailed extends Schema.TaggedError<GateProcessCleanupFailed>()('GateProcessCleanupFailed', {
  file: Schema.String, pids: Schema.Array(Schema.Number), message: Schema.String,
}) {}
export class GateProcessMeasurementFailed extends Schema.TaggedError<GateProcessMeasurementFailed>()('GateProcessMeasurementFailed', {
  pid: Schema.Number, message: Schema.String,
}) {}
interface ProcessSample { readonly pid: number; readonly birth: string; readonly bytes: number; readonly running: boolean }
const sample = (pid: number): ProcessSample | undefined => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const running = fields[0] !== 'Z' && fields[0] !== 'X';
    const rollup = running ? readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8') : '';
    const proportional = /^Pss:\s+(\d+) kB$/mu.exec(rollup);
    if (running && proportional === null) throw new GateProcessMeasurementFailed({ pid, message: 'Process PSS measurement is unavailable' });
    return { pid, birth: fields[19]!, bytes: Number(proportional?.[1] ?? 0) * 1024, running };
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return undefined;
    throw cause;
  }
};

/** PSS apportions shared resident pages; 100ms sampling may miss short peaks. */
export const observeTestProcessTree = (file: string, budgetBytes: number, rootArguments: readonly string[] = [file], includeSupervisor = false, additionalRoots: () => readonly number[] = () => []) => {
  const known = new Map<number, string>();
  let peakBytes = 0;
  let samples = 0;
  let roots = 0;
  const scan = (): ProcessSample[] => {
    for (const pid of additionalRoots()) {
      if (known.has(pid)) continue;
      const current = sample(pid);
      if (current) { known.set(pid, current.birth); roots++; }
    }
    const living: ProcessSample[] = [];
    const visit = (pid: number) => {
      if (living.some(row => row.pid === pid)) return;
      const current = sample(pid);
      if (!current || known.has(pid) && known.get(pid) !== current.birth) return;
      known.set(pid, current.birth);
      if (!current.running) return;
      living.push(current);
      let children: string;
      try { children = readdirSync(`/proc/${pid}/task`).map(thread => {
        try { return readFileSync(`/proc/${pid}/task/${thread}/children`, 'utf8'); }
        catch (cause) {
          if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return '';
          throw cause;
        }
      }).join(' '); }
      catch (cause) {
        if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return;
        throw cause;
      }
      for (const child of children.trim().split(/\s+/u).filter(Boolean)) visit(Number(child));
    };
    for (const pid of known.keys()) visit(pid);
    samples++;
    peakBytes = Math.max(peakBytes, living.reduce((sum, row) => sum + row.bytes, includeSupervisor ? sample(process.pid)?.bytes ?? 0 : 0));
    return living;
  };
  const events = channel('child_process');
  const observe = (message: unknown) => {
    // Node's documented channel publishes the ChildProcess before spawn completes.
    const child = (message as { process: ChildProcess }).process;
    child.once('spawn', () => {
      if (rootArguments.some(argument => child.spawnargs?.includes(argument)) && child.pid !== undefined && process.platform === 'linux') {
        const current = sample(child.pid);
        if (current) { known.set(child.pid, current.birth); roots++; scan(); }
      }
    });
  };
  return Effect.gen(function*() {
    yield* Effect.acquireRelease(Effect.sync(() => { events.subscribe(observe); }), () => Effect.sync(() => { events.unsubscribe(observe); }));
    if (process.platform === 'linux') yield* Effect.gen(function*() { for (;;) { yield* Effect.sync(scan); yield* Effect.sleep('100 millis'); } }).pipe(Effect.forkScoped);
    return {
      finish: Effect.gen(function*() {
        if (process.platform !== 'linux') return { file, budgetBytes, metric: 'sampled-process-tree-pss' as const, state: 'unavailable' as const, peakBytes: null, exceeded: null, samples: 0 };
        let living = yield* Effect.sync(scan);
        // The final TestsStream event can precede child exit and descriptor close.
        // Keep admission while normal shutdown drains; only then classify a leak.
        const normalExitDeadline = performance.now() + 5_000;
        while (living.length > 0 && performance.now() < normalExitDeadline) {
          yield* Effect.sleep('10 millis');
          living = yield* Effect.sync(scan);
        }
        if (living.length > 0) {
          yield* Effect.sync(() => { for (const row of living) { const current = sample(row.pid); if (current?.birth === row.birth && current.running) try { process.kill(row.pid, 'SIGKILL'); } catch {} } });
          const deadline = performance.now() + 5_000;
          let remaining = living;
          while (remaining.length > 0 && performance.now() < deadline) {
            yield* Effect.sleep('10 millis');
            remaining = yield* Effect.sync(scan);
          }
          // A failed confirmation poisons admission before its permit is released.
          if (remaining.length > 0) return yield* new GateProcessCleanupFailed({ file, pids: remaining.map(row => row.pid), message: `${file}: process exit remains unconfirmed after SIGKILL: ${remaining.map(row => row.pid).join(', ')}` });
          return yield* new GateProcessCleanupFailed({ file, pids: living.map(row => row.pid), message: `${file}: descendants survived normal runner shutdown and required SIGKILL: ${living.map(row => row.pid).join(', ')}` });
        }
        return { file, budgetBytes, metric: 'sampled-process-tree-pss' as const, state: roots > 0 ? 'observed' as const : 'unknown' as const,
          peakBytes: roots > 0 ? peakBytes : null, exceeded: roots > 0 ? peakBytes > budgetBytes : null, samples };
      }),
    };
  });
};

/** Chromium is leased by the runner, a sibling of its worker. Join both roots
 * using their published worker identity rather than charging every browser to
 * each worker. Receipts are atomic; missing startup receipts remain unknown. */
export const observeBrowserProcessTrees = Effect.fn('gate.observeBrowserProcessTrees')(function*(output: string, budgetBytes: number) {
  const Receipt = Schema.Struct({ workerID: Schema.NullOr(Schema.String), pid: Schema.Number, phase: Schema.optional(Schema.String), worker: Schema.optional(Schema.Number) });
  const roots = new Map<string, Set<number>>();
  const observations = new Map<string, Effect.Success<ReturnType<typeof observeTestProcessTree>>>();
  const discover = Effect.gen(function*() {
    for (const directory of ['lifecycle-timings', 'browser-processes']) {
      let files: string[];
      try { files = readdirSync(join(output, directory)); }
      catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') continue;
        throw cause;
      }
      for (const file of files.filter(file => file.endsWith('.json'))) {
        const row = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt), { onExcessProperty: 'ignore' })(readFileSync(join(output, directory, file), 'utf8'));
        if (row.workerID === null) continue;
        if (directory === 'lifecycle-timings' && row.phase !== 'worker-start') continue;
        const pids = roots.get(row.workerID) ?? new Set<number>();
        pids.add(directory === 'lifecycle-timings' ? row.worker ?? row.pid : row.pid);
        roots.set(row.workerID, pids);
        const identity = row.workerID;
        if (!observations.has(identity)) observations.set(identity,
          yield* observeTestProcessTree(identity, budgetBytes, [], false, () => [...roots.get(identity)!]));
      }
    }
  });
  yield* Effect.gen(function*() { for (;;) { yield* discover; yield* Effect.sleep('100 millis'); } }).pipe(Effect.forkScoped);
  return { finish: Effect.gen(function*() {
    yield* discover;
    return yield* Effect.forEach([...observations.values()], observation => observation.finish);
  }) };
});
