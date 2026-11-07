// @concord-file
// @concord-implements docs/engineering/testing/README.md#共享资源与同步
import { Effect, Schema } from 'effect';
import { availableParallelism, homedir, hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireRecoverablePublicationLease, assertLeasePath, CoordinationError, readLeaseOwner, releaseFileLease, syncLeaseDirectory } from '../src/base/publication/file-lease.ts';

export const gateSlotCapacity = (cpus = availableParallelism()): number => Math.max(1, Math.floor(cpus / 4));
class GateQueueInvalid extends Schema.TaggedError<GateQueueInvalid>()('GateQueueInvalid', { message: Schema.String }) {}
const Positive = Schema.Int.check(Schema.isGreaterThan(0));
const Request = Schema.Struct({ token: Schema.String, host: Schema.String, pid: Positive, birth: Schema.NullOr(Schema.String),
  slots: Positive, state: Schema.Literals(['waiting', 'running']) });
type Request = typeof Request.Type;
const QueueState = Schema.Struct({ format: Schema.Literal('concord.gate-slots/v1'), capacity: Positive, requests: Schema.Array(Request) });
const processBirth = (pid: number): string | null | undefined => {
  if (process.platform !== 'linux') {
    try { process.kill(pid, 0); return null; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return undefined; throw cause; }
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' || fields[0] === 'X' ? undefined : fields[19];
  } catch (cause) { if (['ENOENT', 'ESRCH'].includes((cause as NodeJS.ErrnoException).code ?? '')) return undefined; throw cause; }
};

const takeLease = (directory: string, mode: 'exclusive' | 'shared') => Effect.try({
  try: () => acquireRecoverablePublicationLease(directory, directory, 'publication.lease', mode, 'gate-queue')!, catch: cause => cause,
}).pipe(Effect.catch(cause => cause instanceof CoordinationError && cause.reason === 'occupied' ? Effect.succeed(undefined) : Effect.fail(cause)));

const acquireLease = (directory: string, mode: 'exclusive' | 'shared', interruptibleWait: boolean) => Effect.gen(function*() {
  for (;;) {
    const lease = yield* takeLease(directory, mode);
    if (lease) return lease;
    const pause = Effect.sleep('50 millis');
    yield* (interruptibleWait ? Effect.interruptible(pause) : pause);
  }
});

/** One short mutex transaction publishes a whole claim; no partial slot acquisition. */
const updateQueue = <A>(directory: string, capacity: number, edit: (requests: Request[]) => A, interruptibleWait = true) => Effect.scoped(Effect.gen(function*() {
  const lock = resolve(directory, 'updates');
  yield* Effect.acquireRelease(acquireLease(lock, 'exclusive', interruptibleWait), lease => Effect.sync(() => releaseFileLease(lease, 'gate-queue')));
  return yield* Effect.try({ try: () => {
    const path = join(directory, 'requests.json');
    assertLeasePath(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.size > 1024 * 1024)) throw new Error('Gate queue state is not a bounded regular file');
    const previous = stat ? readFileSync(path, 'utf8') : '';
    const state = previous ? Schema.decodeUnknownSync(Schema.fromJsonString(QueueState), { onExcessProperty: 'error' })(previous)
      : { format: 'concord.gate-slots/v1' as const, capacity, requests: [] };
    const requests = state.requests.filter(request => {
      if (request.host !== hostname()) throw new Error('Gate queue belongs to another host; preserve unknown process ownership');
      const birth = processBirth(request.pid);
      return birth !== undefined && birth === request.birth;
    });
    if (requests.length && state.capacity !== capacity) throw new Error(`Gate slot capacity changed from ${state.capacity} to ${capacity}`);
    const result = edit(requests);
    let used = requests.filter(request => request.state === 'running').reduce((sum, request) => sum + request.slots, 0);
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i]!;
      if (request.slots > capacity) throw new Error('Gate request exceeds the machine slot capacity');
      if (request.state === 'running') continue;
      if (used + request.slots > capacity) break;
      requests[i] = { ...request, state: 'running' };
      used += request.slots;
    }
    if (used > capacity) throw new Error('Gate queue has more running claims than available slots');
    const text = `${JSON.stringify({ ...state, capacity, requests })}\n`;
    if (text !== previous) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, text, { mode: 0o600 }); renameSync(temporary, path); syncLeaseDirectory(directory); }
      finally { rmSync(temporary, { force: true }); }
    }
    return { result, requests };
  }, catch: cause => new GateQueueInvalid({ message: cause instanceof Error ? cause.message : String(cause) }) });
}));

/** The supervisor owns the machine slot; a systemd re-exec keeps that owner. */
export const withGateQueue = <A, E, R>(body: Effect.Effect<A, E, R>, directory = process.env.CONCORD_GATE_QUEUE_DIRECTORY ?? join(homedir(), '.cache/concord/gate-queue'), options: { readonly demand?: 'all' | 1; readonly cpus?: number } = {}) => Effect.scoped(Effect.gen(function*() {
  const started = performance.now();
  directory = resolve(directory);
  const capacity = gateSlotCapacity(options.cpus);
  const token = randomUUID();
  const request: Request = { token, host: hostname(), pid: process.pid, birth: processBirth(process.pid) ?? null,
    slots: options.demand === 1 ? 1 : capacity, state: 'waiting' };
  yield* Effect.acquireRelease(updateQueue(directory, capacity, requests => { requests.push(request); }), () =>
    updateQueue(directory, capacity, requests => { const index = requests.findIndex(value => value.token === token); if (index >= 0) requests.splice(index, 1); }, false).pipe(Effect.asVoid, Effect.orDie));
  let reportedOwner: string | undefined;
  for (;;) {
      const state = yield* updateQueue(directory, capacity, () => undefined);
      const own = state.requests.find(value => value.token === token);
      if (own?.state === 'running') break;
      const owner = state.requests.find(value => value.token !== token);
      if (owner && owner.token !== reportedOwner) {
        reportedOwner = owner.token;
        yield* Effect.sync(() => console.error(`# Gate queued: waiting for pid=${owner.pid} host=${owner.host}; slots=${request.slots}/${capacity}; slot=${directory}`));
      }
      yield* Effect.sleep('50 millis');
  }
  // Shared leases retain an observable live owner and exclude older exclusive
  // gate/reference invocations while they finish their already-running snapshot.
  yield* Effect.acquireRelease(Effect.gen(function*() {
    // A shared acquisition alone can join a dead shared token. An exclusive
    // probe reclaims that set when every previous owner has exited.
    const stale = yield* takeLease(directory, 'exclusive');
    if (stale) yield* Effect.sync(() => releaseFileLease(stale, 'gate-queue'));
    const lease = yield* takeLease(directory, 'shared');
    if (lease) return lease;
    const owner = yield* Effect.try(() => readLeaseOwner(join(directory, 'publication.lease'), 'gate-queue'));
    if (owner) yield* Effect.sync(() => console.error(`# Gate queued: waiting for pid=${owner.pid} host=${owner.host}; slot=${directory}`));
    return yield* acquireLease(directory, 'shared', true);
  }), lease => Effect.sync(() => releaseFileLease(lease, 'gate-queue')));
  const waitMs = performance.now() - started;
  yield* Effect.sync(() => {
    process.env.CONCORD_GATE_QUEUE_WAIT_MS = String(waitMs);
    console.error(`# Gate queue wait: ${(waitMs / 1000).toFixed(3)}s; excluded from gate wallclock`);
    console.error(`# Gate slots: ${request.slots}/${capacity}`);
  });
  return yield* body;
}));
