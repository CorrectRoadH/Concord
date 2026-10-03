// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { join } from 'node:path';
import { lstatSync } from 'node:fs';
import { Effect } from 'effect';
import { acquireFileLease, assertLeasePath, CoordinationError, readLeaseOwner, recoverFileLease, releaseFileLease, type FileLease } from './file-lease.js';
import { HawdbFailure, hawdbIdentity } from './hawdb-native.js';
import { ConcordError, failure } from './shared.js';
import { assertCurrentRuntimeFormat } from './storage.js';
import { ViewScanManager } from './view-scan.js';
import { ViewSourceWatch } from './view-source-watch.js';
import { decodeWorkspaceProjectionRecord, readWorkspaceProjection, storeWorkspaceProjection, workspaceProjectionContext, type WorkspaceProjectionContext, type WorkspaceProjectionRecord } from './workspace-projection.js';
import type { WorkspaceProjection } from './view-contract.js';

const projectionFailure = (cause: unknown): ConcordError => cause instanceof HawdbFailure ? new ConcordError(cause.code, cause.message) : failure(cause);

/** A worktree has one refresh owner. HTTP never joins the scan or reads sources. */
export class ViewProjectionManager {
  private readonly scans: ViewScanManager;
  private active: Promise<void> | undefined;
  private scheduled: NodeJS.Immediate | undefined;
  private lease: FileLease | undefined;
  private pending = false;
  private stopping = false;
  private cleanupFailed = false;
  private lastStarted = -Infinity;
  private retryAfter = 0;
  private lastFailure: ConcordError | undefined;
  private readonly watch: ViewSourceWatch;
  private watchFailure: ConcordError | undefined;
  private watchSetup: Promise<void> | undefined;
  private periodic: NodeJS.Timeout | undefined;
  private invalidation: NodeJS.Timeout | undefined;
  private invalidatedAt = 0;
  constructor(private readonly root: string) {
    this.scans = new ViewScanManager(root);
    this.watch = new ViewSourceWatch(root, () => this.invalidate(), error => { this.watchFailure = error; });
  }

  /** Server-owned refresh continues even when no browser is connected. */
  start(): void {
    if (this.periodic || this.stopping) return;
    this.periodic = setInterval(() => {
      // A compensation tick never queues another scan behind an active one.
      if (!this.active && !this.scheduled) this.request(true);
    }, 30_000);
    this.periodic.unref();
    this.watchSetup = this.watch.reconcile(null).then(() => undefined, cause => { this.watchFailure = projectionFailure(cause); });
    void this.watchSetup.then(() => this.request(true));
  }

  private invalidate(delay = 250): void {
    if (this.stopping || this.cleanupFailed) return;
    const now = Date.now();
    if (!this.invalidation) this.invalidatedAt = now;
    else clearTimeout(this.invalidation);
    this.invalidation = setTimeout(() => {
      this.invalidation = undefined;
      this.request(true);
    }, Math.max(0, Math.min(delay, this.invalidatedAt + 2000 - now)));
    this.invalidation.unref();
  }

  async read(): Promise<WorkspaceProjection> {
    const deadline = performance.now() + 500;
    while (true) {
      try { return this.readOnce(); }
      catch (cause) {
        if (!(cause instanceof ConcordError) || cause.code !== 'WorkspaceProjectionUnavailable'
          || typeof cause.details !== 'object' || cause.details === null || !('reason' in cause.details)
          || cause.details.reason !== 'HawdbBusy' || this.stopping || performance.now() >= deadline) throw cause;
        // 短暂写入也会排斥读取；让出事件循环，释放句柄后重新执行完整校验。
        await Effect.runPromise(Effect.sleep('10 millis'));
      }
    }
  }

  private readOnce(): WorkspaceProjection {
    const context = workspaceProjectionContext(this.root);
    try {
      const value = readWorkspaceProjection(context);
      if (this.watchFailure && value.projection.status === 'ready') return { ...value, projection: { ...value.projection, status: 'refresh-failed',
        lastError: { failedAt: Number.isFinite(this.lastStarted) ? new Date(this.lastStarted).toISOString() : value.projection.builtUntil,
          code: this.watchFailure.code, message: this.watchFailure.message.slice(0, 4096) } } };
      if (!this.lastFailure || !this.cleanupFailed && Date.parse(value.projection.builtUntil) > this.lastStarted) return value;
      return { ...value, projection: { ...value.projection, status: this.lastFailure.code === 'RecoveryRequired' ? 'blocked' : 'refresh-failed',
        lastError: { failedAt: new Date(this.lastStarted).toISOString(), code: this.lastFailure.code, message: this.lastFailure.message.slice(0, 4096) } } };
    } catch (cause) {
      if (cause instanceof ConcordError && cause.code === 'WorkspaceProjectionPending' && this.lastFailure?.code === 'RecoveryRequired') throw this.lastFailure;
      if (cause instanceof ConcordError && cause.code === 'WorkspaceProjectionPending' && this.cleanupFailed) throw new ConcordError('CleanupFailed', 'Workspace cleanup is unconfirmed; restart View');
      throw cause;
    }
  }

  request(explicit = false): void {
    if (this.stopping || this.cleanupFailed) return;
    if (this.active) { if (explicit) this.pending = true; return; }
    if (this.scheduled || !explicit && Date.now() < this.retryAfter) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = undefined;
      if (this.stopping) return;
      this.lastStarted = Date.now();
      this.retryAfter = this.lastStarted + 30_000;
      this.active = Effect.runPromise(Effect.tryPromise({ try: () => this.refresh(), catch: projectionFailure })).catch(cause => {
        this.lastFailure = projectionFailure(cause);
        this.retryAfter = Date.now() + 30_000;
      }).finally(() => {
        this.active = undefined;
        if (this.pending) { this.pending = false; this.request(true); }
      });
    });
  }

  retry(): void {
    if (this.stopping || this.cleanupFailed) throw new ConcordError(this.cleanupFailed ? 'CleanupFailed' : 'ServerStopping', 'Workspace refresh is stopped; restart View');
    try { hawdbIdentity(); }
    catch (cause) { throw new ConcordError('WorkspaceProjectionUnavailable', 'Native cache is unavailable; repair the installation and restart View', { reason: cause instanceof Error && 'code' in cause ? cause.code : 'HawdbUnavailable' }); }
    this.request(true);
  }

  private acquire(context: WorkspaceProjectionContext): FileLease | undefined {
    const directory = join(context.privateDir, 'workspace-refresh');
    try { return acquireFileLease(context.root, directory, 'current', 'exclusive', 'workspace-refresh'); }
    catch (cause) {
      if (!(cause instanceof CoordinationError) || cause.reason !== 'occupied') throw cause;
      try { recoverFileLease(context.root, join(directory, 'current'), 'workspace-refresh-recover'); }
      catch { return undefined; }
      try { return acquireFileLease(context.root, directory, 'current', 'exclusive', 'workspace-refresh'); }
      catch (retry) { if (retry instanceof CoordinationError && retry.reason === 'occupied') return undefined; throw retry; }
    }
  }

  private verify(context: WorkspaceProjectionContext): void {
    const owner = this.lease && readLeaseOwner(this.lease.path, 'workspace-refresh-publish');
    if (!owner || owner.token !== this.lease?.owner.token || owner.pid !== process.pid) throw new ConcordError('WorkspaceRefreshOwnershipLost', 'Workspace refresh lease changed; candidate discarded');
    if (workspaceProjectionContext(this.root).identity !== context.identity) throw new ConcordError('WorkspaceProjectionIdentityChanged', 'Workspace configuration or installation changed; candidate discarded');
  }

  private ready(context: WorkspaceProjectionContext): void {
    assertCurrentRuntimeFormat(context.root, context.privateDir);
    for (const relative of ['journal.json', 'trace/publication-journal.json', 'trace/multi-file-publication-journal.json']) {
      const path = join(context.privateDir, relative);
      assertLeasePath(path);
      if (lstatSync(path, { throwIfNoEntry: false })) throw new ConcordError('RecoveryRequired', 'An interrupted publication exists; run concord recover');
    }
  }

  private async persist(context: WorkspaceProjectionContext, candidate?: WorkspaceProjectionRecord, error?: ConcordError): Promise<void> {
    const deadline = performance.now() + 3000;
    while (!this.stopping) {
      this.verify(context);
      if (candidate !== undefined) this.ready(context);
      try { storeWorkspaceProjection(context, candidate, error); return; }
      catch (cause) {
        if (!(cause instanceof HawdbFailure) || cause.code !== 'HawdbBusy' || performance.now() >= deadline) throw cause;
        // 候选已经完成扫描，缓存短暂占用不应丢弃它并等待下一轮扫描。
        // 等待后必须重新检查身份与发布权限，关闭服务后不得写入。
        await Effect.runPromise(Effect.sleep('25 millis'));
      }
    }
  }

  private async refresh(): Promise<void> {
    const context = workspaceProjectionContext(this.root);
    hawdbIdentity();
    const lease = this.acquire(context);
    if (!lease) return;
    this.lease = lease;
    try {
      this.ready(context);
      const reply = await this.scans.scan();
      if (this.stopping) return;
      const candidate = decodeWorkspaceProjectionRecord(JSON.parse(reply.body));
      try {
        if (await this.watch.reconcile(candidate.snapshot.project, candidate.snapshot.sources)) this.pending = true;
        this.watchFailure = undefined;
      } catch (cause) { this.watchFailure = projectionFailure(cause); }
      if (this.stopping) return;
      await this.persist(context, candidate, this.watchFailure);
      if (!candidate.consistent) this.invalidate(1000);
      this.lastFailure = undefined;
    } catch (cause) {
      const error = projectionFailure(cause);
      if (error.code === 'WorkspaceProjectionIdentityChanged') {
        // The new identity has no generation yet; build it now instead of reporting a failure.
        this.lastFailure = undefined;
        this.pending = true;
        return;
      }
      this.lastFailure = error;
      this.retryAfter = Date.now() + 30_000;
      if (error.code === 'CleanupFailed') this.cleanupFailed = true;
      if (!this.stopping) {
        await this.persist(context, undefined, error);
      }
    } finally {
      if (!this.cleanupFailed && !this.stopping) {
        try { releaseFileLease(lease, 'workspace-refresh-close'); this.lease = undefined; }
        catch { this.cleanupFailed = true; this.lastFailure = new ConcordError('CleanupFailed', 'Refresh ownership cleanup failed; restart View'); }
      }
    }
  }

  async close(): Promise<void> {
    this.stopping = true;
    this.pending = false;
    if (this.periodic) { clearInterval(this.periodic); this.periodic = undefined; }
    if (this.invalidation) { clearTimeout(this.invalidation); this.invalidation = undefined; }
    this.watch.close();
    if (this.scheduled) { clearImmediate(this.scheduled); this.scheduled = undefined; }
    try { await this.watchSetup; await this.scans.close(); await this.active; }
    catch (cause) { this.cleanupFailed = true; throw cause; }
    if (this.cleanupFailed) throw new ConcordError('CleanupFailed', 'Workspace cleanup is unconfirmed; preserve the refresh lease');
    if (this.lease) { releaseFileLease(this.lease, 'workspace-refresh-close'); this.lease = undefined; }
  }
}
