// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#worker-requests
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { Schema } from 'effect';
import { DatabaseOperation, DatabaseReply, type DatabaseRequest, type DatabaseValue } from './worker-protocol.ts';
import { HawdbFailure, MIB } from './hawdb-types.ts';
import { compiledInstallation } from '../installation/index.ts';
interface Pending {
  readonly request: DatabaseRequest; readonly bytes: number; readonly background: boolean;
  readonly resolve: (value: DatabaseValue) => void; readonly reject: (error: HawdbFailure) => void;
  readonly cleanup: () => void;
}
/** One native request at a time, with admission bounded before structured cloning. */
export class DatabaseWorker {
  private readonly worker = new Worker(new URL(compiledInstallation ? './base/cache/worker-entry.js' : './worker-entry.ts', import.meta.url));
  private readonly id = randomUUID();
  private nextId = 0;
  private pendingBytes = 0;
  private active: Pending | undefined;
  private readonly queue: Pending[] = [];
  private closing = false;
  private closed: Promise<void> | undefined;
  private fatal: HawdbFailure | undefined;
  private readonly exited: Promise<void>;
  readonly onFatal: (error: HawdbFailure) => void;
  constructor(onFatal: (error: HawdbFailure) => void = () => {}) {
    this.onFatal = onFatal;
    this.exited = new Promise(resolve => this.worker.once('exit', () => { if (!this.closing || this.active || this.queue.length) this.fail(new HawdbFailure('HawdbUnavailable', 'Database Worker exited unexpectedly')); resolve(); }));
    this.worker.on('error', cause => this.fail(new HawdbFailure('HawdbUnavailable', `Database Worker failed: ${String(cause)}`)));
    this.worker.on('message', (raw: unknown) => {
      if (this.fatal) return;
      try {
        const reply = Schema.decodeUnknownSync(DatabaseReply, { onExcessProperty: 'error' })(raw), pending = this.active;
        if (!pending || reply.workerId !== this.id || reply.id !== pending.request.id) throw new HawdbFailure('HawdbIncompatible', 'Database Worker reply identity differs');
        this.active = undefined; this.pendingBytes -= pending.bytes; pending.cleanup();
        if (reply.outcome.ok) {
          if (pending.request.operation.op !== 'close' && (Atomics.load(new Int32Array(pending.request.control), 0) !== 0 || process.hrtime.bigint() >= pending.request.deadline)) pending.reject(new HawdbFailure('HawdbCancelled', 'Database request was cancelled'));
          else pending.resolve(reply.outcome.value);
        } else pending.reject(new HawdbFailure(reply.outcome.code, reply.outcome.message));
        this.dispatch();
      } catch (cause) { this.fail(cause instanceof HawdbFailure ? cause : new HawdbFailure('HawdbIncompatible', String(cause))); }
    });
  }
  private fail(error: HawdbFailure): void {
    if (this.fatal) return;
    this.fatal = error;
    const pending = [...(this.active ? [this.active] : []), ...this.queue];
    for (const request of pending) Atomics.store(new Int32Array(request.request.control), 0, 1);
    this.queue.length = 0; this.active = undefined; this.pendingBytes = 0;
    this.closing = true;
    // Even a protocol failure must drain synchronous FFI before releasing callers.
    try { this.worker.postMessage({ workerId: this.id, id: ++this.nextId, control: new SharedArrayBuffer(4), deadline: process.hrtime.bigint() + 600_000_000_000n, operation: { op: 'close' } } satisfies DatabaseRequest); } catch { /* An exited Worker has already drained. */ }
    void this.exited.then(() => { for (const request of pending) { request.cleanup(); request.reject(error); } });
    this.onFatal(error);
  }
  private dispatch(): void {
    if (this.active || this.fatal) return;
    const first = this.queue.findIndex(value => !value.background);
    const next = this.queue.splice(first < 0 ? 0 : first, 1)[0];
    if (!next) return;
    // Assign monotonic wire ids at dispatch, after priority ordering.
    const pending = { ...next, request: { ...next.request, id: ++this.nextId } };
    this.active = pending;
    this.worker.postMessage(pending.request);
  }
  private cancel(control: SharedArrayBuffer): void {
    Atomics.store(new Int32Array(control), 0, 1);
    const index = this.queue.findIndex(pending => pending.request.control === control);
    if (index < 0) return;
    const pending = this.queue.splice(index, 1)[0]!;
    this.pendingBytes -= pending.bytes;
    pending.cleanup();
    pending.reject(new HawdbFailure('HawdbCancelled', 'Queued database request was cancelled'));
  }
  request(input: DatabaseOperation, options: { readonly signal?: AbortSignal; readonly background?: boolean; readonly deadline?: bigint } = {}): Promise<DatabaseValue> {
    if (this.fatal) return Promise.reject(this.fatal);
    if (this.closing && input.op !== 'close') return Promise.reject(new HawdbFailure('HawdbClosed', 'Database Worker is draining'));
    let operation: DatabaseOperation;
    try { operation = Schema.decodeUnknownSync(DatabaseOperation, { onExcessProperty: 'error' })(input); }
    catch (cause) { return Promise.reject(new HawdbFailure('HawdbIncompatible', `Invalid database request: ${String(cause)}`)); }
    const bytes = Buffer.byteLength(JSON.stringify(operation));
    if (operation.op !== 'close' && (this.queue.length >= 16 || bytes > 64 * MIB || this.pendingBytes + bytes > 128 * MIB)) return Promise.reject(new HawdbFailure('HawdbLimit', 'Database Worker admission budget exceeded'));
    const deadline = options.deadline ?? process.hrtime.bigint() + 600_000_000_000n;
    if (options.signal?.aborted || process.hrtime.bigint() >= deadline) return Promise.reject(new HawdbFailure('HawdbCancelled', 'Database request was cancelled before admission'));
    const control = new SharedArrayBuffer(4), cancel = () => this.cancel(control);
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, Math.max(0, Math.min(600000, Number((deadline - process.hrtime.bigint()) / 1000000n))));
    return new Promise((resolve, reject) => {
      this.pendingBytes += bytes;
      this.queue.push({ request: { workerId: this.id, id: 0, deadline, control, operation }, bytes, background: options.background ?? false, resolve, reject, cleanup: () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); } });
      this.dispatch();
    });
  }
  close(): Promise<void> {
    return this.closed ??= (async () => {
      this.closing = true;
      for (const pending of [...(this.active ? [this.active] : []), ...this.queue]) this.cancel(pending.request.control);
      // A rejected/cancelled caller is not proof that a synchronous FFI call has drained.
      try { if (!this.fatal) await this.request({ op: 'close' }, { background: true }); }
      finally { await this.exited; }
    })();
  }
}
