// @concord-file
// @concord-implements docs/engineering/testing/cli.md#并发
import { Effect, Schema } from 'effect';
import { channel } from 'node:diagnostics_channel';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { observeOwnedProcessGroup } from '../src/base/process/owned-process.ts';

export class GateProcessCleanupFailed extends Schema.TaggedError<GateProcessCleanupFailed>()('GateProcessCleanupFailed', {
  file: Schema.String, pids: Schema.Array(Schema.Number), message: Schema.String,
}) {}
export class GateProcessMeasurementFailed extends Schema.TaggedError<GateProcessMeasurementFailed>()('GateProcessMeasurementFailed', {
  pid: Schema.Number, message: Schema.String,
}) {}
export const GateProcessIdentity = Schema.Struct({ pid: Schema.Int, birth: Schema.String });
export type GateProcessIdentity = typeof GateProcessIdentity.Type;
interface ProcessSample extends GateProcessIdentity { readonly bytes: number; readonly running: boolean }
const childrenOf = (pid: number): number[] => {
  try { return readdirSync(`/proc/${pid}/task`).flatMap(thread => {
    try { return readFileSync(`/proc/${pid}/task/${thread}/children`, 'utf8').trim().split(/\s+/u).filter(Boolean).map(Number); }
    catch (cause) {
      if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return [];
      throw cause;
    }
  }); } catch (cause) {
    if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return [];
    throw cause;
  }
};
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

/** Group membership survives a short-lived parent's reparenting of its descendants. */
const groupMembers = (group: number): number[] => readdirSync('/proc').filter(name => /^\d+$/u.test(name)).flatMap(name => {
  try {
    const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(fields[2]) === group ? [Number(name)] : [];
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && ['ENOENT', 'ESRCH'].includes(String(cause.code))) return [];
    throw cause;
  }
});

/** PSS apportions shared resident pages; 100ms sampling may miss short peaks. */
export const observeTestProcessTree = (file: string, budgetBytes: number, rootArguments: readonly string[] = [file], includeSupervisor = false, additionalRoots: () => readonly number[] = () => []) => {
  const known = new Map<number, string>();
  const groups = new Set<number>();
  let peakBytes = 0;
  let samples = 0;
  let roots = includeSupervisor && process.platform === 'linux' ? 1 : 0;
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
      for (const child of childrenOf(pid)) visit(child);
    };
    for (const group of groups) for (const pid of groupMembers(group)) visit(pid);
    for (const pid of known.keys()) visit(pid);
    samples++;
    peakBytes = Math.max(peakBytes, living.reduce((sum, row) => sum + row.bytes, includeSupervisor ? sample(process.pid)?.bytes ?? 0 : 0));
    return living;
  };
  const events = channel('child_process');
  const register = (pid: number, processGroup = false) => Effect.sync(() => {
    if (processGroup) groups.add(pid);
    if (process.platform !== 'linux') return;
    if (known.has(pid)) return;
    const current = sample(pid);
    if (current) { known.set(pid, current.birth); roots++; scan(); }
  });
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
      // Explicitly owned handles do not depend on a runtime's diagnostics channel.
      register,
      finish: Effect.gen(function*() {
        // Memory availability and owned POSIX group cleanup are independent.
        // kill(-pgid, 0) also confirms groups on platforms without /proc.
        const pendingGroups = () => [...groups].filter(group => {
          const state = observeOwnedProcessGroup(group);
          return state !== 'gone' && state !== 'zombie-only';
        });
        const scanLiving = () => process.platform === 'linux' ? scan() : [];
        let living = yield* Effect.sync(scanLiving);
        let pending = yield* Effect.sync(pendingGroups);
        // Keep admission while normal shutdown drains; only then classify a leak.
        const normalExitDeadline = performance.now() + 5_000;
        while ((living.length > 0 || pending.length > 0) && performance.now() < normalExitDeadline) {
          yield* Effect.sleep('10 millis');
          living = yield* Effect.sync(scanLiving);
          pending = yield* Effect.sync(pendingGroups);
        }
        if (living.length > 0 || pending.length > 0) {
          yield* Effect.sync(() => {
            for (const group of pending) {
              try { process.kill(-group, 'SIGKILL'); } catch (cause) {
                if (!(cause instanceof Error && 'code' in cause && cause.code === 'ESRCH')) throw cause;
              }
            }
            for (const row of living) { const current = sample(row.pid); if (current?.birth === row.birth && current.running) try { process.kill(row.pid, 'SIGKILL'); } catch {} }
          });
          const deadline = performance.now() + 5_000;
          let remaining = living;
          while ((remaining.length > 0 || pending.length > 0) && performance.now() < deadline) {
            yield* Effect.sleep('10 millis');
            remaining = yield* Effect.sync(scanLiving);
            pending = yield* Effect.sync(pendingGroups);
          }
          // A failed confirmation poisons admission before its permit is released.
          if (remaining.length > 0 || pending.length > 0) return yield* new GateProcessCleanupFailed({ file, pids: [...new Set([...remaining.map(row => row.pid), ...pending])], message: `${file}: process/group exit remains unconfirmed after SIGKILL; groups=${pending.join(', ')}; pids=${remaining.map(row => row.pid).join(', ')}` });
          return yield* new GateProcessCleanupFailed({ file, pids: living.map(row => row.pid), message: `${file}: descendants survived normal runner shutdown and required SIGKILL: ${living.map(row => row.pid).join(', ')}` });
        }
        if (process.platform !== 'linux') return { file, budgetBytes, metric: 'sampled-process-tree-pss' as const, state: 'unavailable' as const, peakBytes: null, exceeded: null, samples: 0, processes: [] };
        return { file, budgetBytes, metric: 'sampled-process-tree-pss' as const, state: roots > 0 ? 'observed' as const : 'unknown' as const,
          peakBytes: roots > 0 ? peakBytes : null, exceeded: roots > 0 ? peakBytes > budgetBytes : null, samples,
          processes: [...known].map(([pid, birth]) => ({ pid, birth })) };
      }),
    };
  });
};

/** Shared schedulers belong to fixed overhead. Classify historical samples only
 * after admission owners have published their complete process identities. */
export const observeFixedGateMemory = (budgetBytes: number) => Effect.gen(function*() {
  const frames: { process: ProcessSample; ancestors: readonly GateProcessIdentity[] }[][] = [];
  const scan = () => {
    const frame: typeof frames[number] = [];
    const seen = new Set<number>();
    const visit = (pid: number, ancestors: readonly GateProcessIdentity[]) => {
      if (seen.has(pid)) return;
      seen.add(pid);
      const current = sample(pid);
      if (!current?.running) return;
      frame.push({ process: current, ancestors });
      for (const child of childrenOf(pid)) visit(child, [...ancestors, current]);
    };
    visit(process.pid, []);
    frames.push(frame);
  };
  if (process.platform === 'linux') yield* Effect.gen(function*() { for (;;) { yield* Effect.sync(scan); yield* Effect.sleep('100 millis'); } }).pipe(Effect.forkScoped);
  return { finish: (admitted: readonly GateProcessIdentity[], complete: boolean) => Effect.sync(() => {
    if (process.platform !== 'linux') return { file: 'fixed-overhead', budgetBytes, metric: 'sampled-process-tree-pss' as const, state: 'unavailable' as const, peakBytes: null, observedPeakBytes: null, exceeded: null, samples: 0 };
    scan();
    const owned = new Set(admitted.map(row => `${row.pid}:${row.birth}`));
    const isOwned = (row: GateProcessIdentity) => owned.has(`${row.pid}:${row.birth}`);
    const observedPeakBytes = Math.max(0, ...frames.map(frame => frame.reduce((sum, row) => sum + (isOwned(row.process) || row.ancestors.some(isOwned) ? 0 : row.process.bytes), 0)));
    return { file: 'fixed-overhead', budgetBytes, metric: 'sampled-process-tree-pss' as const, state: complete ? 'observed' as const : 'unknown' as const,
      peakBytes: complete ? observedPeakBytes : null, observedPeakBytes, exceeded: complete ? observedPeakBytes > budgetBytes : null, samples: frames.length };
  }) };
});
