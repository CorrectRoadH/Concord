// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { makeOwnedProcessService } from './owned-process.js';
import { ConcordError } from './shared.js';
import { MAX_SCAN_REPLY_BYTES, ScanMessage, type ScanSuccess } from './view-scan-protocol.js';

interface Waiter {
  resolve(value: ScanSuccess): void;
  reject(error: unknown): void;
  detach(): void;
}
interface ScanProcess { controller: AbortController; ready: Promise<(message: unknown) => Promise<void>>; settled: Promise<void>; stopError?: ConcordError; pending?: { id: number; resolve(value: ScanSuccess): void; reject(error: unknown): void } }
interface Generation { controller: AbortController; waiters: Set<Waiter>; settled: Promise<void> }

/** No completed snapshot cache. Arrivals during a scan wait for a fresh generation. */
export class ViewScanManager {
  private active: Generation | undefined;
  private worker: ScanProcess | undefined;
  private nextId = 0;
  private readonly queued = new Set<Waiter>();
  private stopping = false;
  private cleanupFailed = false;
  constructor(private readonly root: string) {}

  scan(signal?: AbortSignal): Promise<ScanSuccess> {
    if (this.cleanupFailed) return Promise.reject(new ConcordError('CleanupFailed', 'Workspace scan cleanup is unconfirmed'));
    if (this.stopping) return Promise.reject(new ConcordError('ServerStopping', 'The workbench is shutting down'));
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.queued.delete(waiter);
        this.active?.waiters.delete(waiter);
        waiter.detach();
        reject(new ConcordError('WorkspaceScanCancelled', 'Workspace request was cancelled'));
        if (this.active?.waiters.size === 0) this.active.controller.abort();
      };
      const waiter: Waiter = { resolve, reject, detach: () => signal?.removeEventListener('abort', cancel) };
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      this.queued.add(waiter);
      queueMicrotask(() => this.pump());
    });
  }

  private pump(): void {
    if (this.active || this.queued.size === 0) return;
    if (this.stopping || this.cleanupFailed) {
      for (const waiter of this.queued) { waiter.detach(); waiter.reject(new ConcordError(this.cleanupFailed ? 'CleanupFailed' : 'ServerStopping', 'Workspace scanning is stopped')); }
      this.queued.clear(); return;
    }
    const generation: Generation = { controller: new AbortController(), waiters: new Set(this.queued), settled: Promise.resolve() };
    this.queued.clear();
    this.active = generation;
    generation.settled = this.run(generation.controller).then(
      result => { for (const waiter of generation.waiters) { waiter.detach(); waiter.resolve(result); } },
      error => { for (const waiter of generation.waiters) { waiter.detach(); waiter.reject(error); } },
    ).finally(() => { this.active = undefined; this.pump(); });
  }

  private startWorker(): ScanProcess {
    const service = makeOwnedProcessService();
    let ready!: (send: (message: unknown) => Promise<void>) => void;
    const worker: ScanProcess = { controller: new AbortController(), ready: new Promise(resolve => { ready = resolve; }), settled: Promise.resolve() };
    this.worker = worker;
    const root = this.root;
    let failure: unknown = new ConcordError('WorkspaceScanFailed', 'Workspace scan process exited');
    const task = service.run([process.execPath, fileURLToPath(new URL('./view-scan-worker.js', import.meta.url)), root], {
      cwd: root,
      ipc: {
        ready,
        message: input => {
          if (worker.controller.signal.aborted) return;
          try {
            const message = Schema.decodeUnknownSync(ScanMessage, { onExcessProperty: 'error' })(input);
            const pending = worker.pending;
            if (!pending || pending.id !== message.id) throw new Error('Unexpected workspace generation');
            if (message.reply.kind === 'failure') {
              worker.stopError = new ConcordError(message.reply.code, message.reply.message, message.reply.details);
              worker.controller.abort();
              return;
            }
            if (Buffer.byteLength(message.reply.body, 'utf8') > MAX_SCAN_REPLY_BYTES) throw new ConcordError('WorkspaceScanOutputLimit', 'Workspace reply exceeds 128 MiB');
            worker.pending = undefined;
            pending.resolve(message.reply);
          } catch (cause) { worker.stopError = cause instanceof ConcordError ? cause : new ConcordError('WorkspaceScanProtocol', 'Invalid workspace scan reply'); worker.controller.abort(); }
        },
      },
    }).pipe(Effect.scoped);
    worker.settled = Effect.runPromise(task, { signal: worker.controller.signal }).then(result => {
      failure = new ConcordError('WorkspaceScanFailed', result.error ?? `Workspace scan process exited (${result.exitCode ?? result.signal})`);
    }, error => { failure = error; }).then(async () => {
      const results = await Effect.runPromise(service.cleanupResults);
      try {
        for (const result of results) {
          if (result.processGroupOwned && (result.groupCleanup.gone !== true || result.groupCleanup.groupId === undefined)) throw new Error('Scan process group exit is unconfirmed');
        }
      } catch {
        this.cleanupFailed = true;
        failure = new ConcordError('CleanupFailed', 'Workspace scan process cleanup could not be confirmed');
      }
      if (this.worker === worker) this.worker = undefined;
      worker.pending?.reject(this.cleanupFailed ? failure : worker.stopError ?? failure);
      worker.pending = undefined;
      // Unblock a request if spawning failed before the ready event.
      ready(() => Promise.reject(failure));
    });
    return worker;
  }

  private async run(controller: AbortController): Promise<ScanSuccess> {
    if (this.worker?.controller.signal.aborted) await this.worker.settled;
    if (this.cleanupFailed) throw new ConcordError('CleanupFailed', 'Workspace scan cleanup is unconfirmed');
    const worker = this.worker ?? this.startWorker();
    const id = this.nextId++;
    return new Promise<ScanSuccess>((resolve, reject) => {
      const stop = (error: ConcordError) => {
        worker.stopError ??= error;
        worker.controller.abort();
        void worker.settled.then(() => reject(this.cleanupFailed ? new ConcordError('CleanupFailed', 'Workspace scan cleanup is unconfirmed') : error));
      };
      const cancel = () => stop(new ConcordError('WorkspaceScanCancelled', 'Workspace request was cancelled'));
      const timeout = setTimeout(() => stop(new ConcordError('WorkspaceScanTimeout', 'Workspace scan exceeded 60 seconds')), 60_000);
      const detach = () => { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); };
      worker.pending = { id, resolve: value => { detach(); resolve(value); }, reject: error => { detach(); reject(error); } };
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) { cancel(); return; }
      void worker.ready.then(send => { if (!controller.signal.aborted) return send({ id }); }).catch(() => stop(new ConcordError('WorkspaceScanFailed', 'Cannot send workspace scan request')));
    });
  }

  async close(): Promise<void> {
    this.stopping = true;
    for (const waiter of this.queued) { waiter.detach(); waiter.reject(new ConcordError('ServerStopping', 'The workbench is shutting down')); }
    this.queued.clear();
    this.active?.controller.abort();
    await this.active?.settled;
    this.worker?.controller.abort();
    await this.worker?.settled;
    if (this.cleanupFailed) throw new ConcordError('CleanupFailed', 'Workspace scan cleanup could not be confirmed');
  }
}
