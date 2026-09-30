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
import { decodeWorkspaceProjectionRecord, readWorkspaceProjection, storeWorkspaceProjection, workspaceProjectionContext, type WorkspaceProjectionContext } from './workspace-projection.js';
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
  constructor(private readonly root: string) { this.scans = new ViewScanManager(root); }

  read(): WorkspaceProjection {
    this.request();
    const context = workspaceProjectionContext(this.root);
    try {
      const value = readWorkspaceProjection(context);
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
      this.verify(context);
      this.ready(context);
      storeWorkspaceProjection(context, candidate);
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
        this.verify(context);
        storeWorkspaceProjection(context, undefined, error);
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
    if (this.scheduled) { clearImmediate(this.scheduled); this.scheduled = undefined; }
    try { await this.scans.close(); await this.active; }
    catch (cause) { this.cleanupFailed = true; throw cause; }
    if (this.cleanupFailed) throw new ConcordError('CleanupFailed', 'Workspace cleanup is unconfirmed; preserve the refresh lease');
    if (this.lease) { releaseFileLease(this.lease, 'workspace-refresh-close'); this.lease = undefined; }
  }
}
