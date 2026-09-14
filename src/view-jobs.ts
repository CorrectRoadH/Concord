// @concord-file web-workbench-test-jobs
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { randomUUID } from 'node:crypto';
import { Cause, Effect, Exit, Option } from 'effect';
import { runCase } from './evidence.js';
import { hasConfirmedOwnedGroupCleanup, makeOwnedProcessService, OwnedProcess, type OwnedProcessService } from './owned-process.js';
import { ConcordError, failure } from './shared.js';
import { LocalRepository } from './storage.js';
import { buildTrace, requireValidTrace, selectCase } from './trace.js';
import type { ViewJob, ViewJobState } from './view-contract.js';

interface JobRecord {
  readonly id: string;
  readonly caseId: string;
  readonly startedAt: string;
  state: ViewJobState;
  finishedAt?: string;
  evidence?: ViewJob['evidence'];
  error?: ViewJob['error'];
  cancelRequested: boolean;
  readonly process: OwnedProcessService;
  promise?: Promise<void>;
  retainedRepository?: LocalRepository;
}

const terminal = new Set<ViewJobState>(['cancelled', 'completed', 'failed', 'cleanup-failed']);
const now = (): string => new Date().toISOString();
const publicJob = (job: JobRecord): ViewJob => ({
  id: job.id,
  caseId: job.caseId,
  state: job.state,
  startedAt: job.startedAt,
  ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  ...(job.evidence === undefined ? {} : { evidence: job.evidence }),
  ...(job.error === undefined ? {} : { error: job.error }),
});

function exitError(exit: Exit.Exit<unknown, unknown>): ConcordError {
  if (Exit.isSuccess(exit)) return new ConcordError('JobFailed', 'The job did not produce evidence');
  const selected = Cause.findErrorOption(exit.cause);
  return Option.isSome(selected) ? failure(selected.value) : new ConcordError('JobInterrupted', Cause.pretty(exit.cause));
}

/** Server-owned single-slot job runner. Repository and child-process ownership end together. */
export class ViewJobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private active: JobRecord | undefined;
  private stopped = false;

  constructor(readonly root: string) {}

  list(): readonly ViewJob[] {
    return [...this.jobs.values()].map(publicJob).reverse();
  }

  start(caseId: string): ViewJob {
    if (!caseId || caseId.trim() !== caseId) throw new ConcordError('InvalidInput', 'caseId must be non-empty and have no surrounding whitespace');
    if (this.stopped) throw new ConcordError('ServerStopping', 'The view server is stopping');
    if (this.active !== undefined) {
      if (this.active.state === 'cleanup-failed') throw new ConcordError('CleanupFailed', 'A previous job could not confirm process-group cleanup; restart after inspecting the repository lock');
      throw new ConcordError('JobBusy', 'Only one test job may run at a time');
    }
    const job: JobRecord = {
      id: `ccjob_${randomUUID()}`,
      caseId,
      state: 'queued',
      startedAt: now(),
      cancelRequested: false,
      process: makeOwnedProcessService(),
    };
    this.jobs.set(job.id, job);
    this.active = job;
    job.promise = new Promise<void>((resolve) => queueMicrotask(() => { void this.execute(job).finally(resolve); }));
    this.trim();
    return publicJob(job);
  }

  cancel(id: string): ViewJob {
    const job = this.jobs.get(id);
    if (job === undefined) throw new ConcordError('JobNotFound', `No test job has ID ${id}`);
    if (terminal.has(job.state)) return publicJob(job);
    job.cancelRequested = true;
    job.state = 'cancelling';
    void Effect.runPromise(job.process.requestStop('SIGTERM'));
    return publicJob(job);
  }

  async close(): Promise<void> {
    this.stopped = true;
    const job = this.active;
    if (job === undefined) return;
    this.cancel(job.id);
    await job.promise;
    if (job.state === 'cleanup-failed') throw new ConcordError('CleanupFailed', 'Server shutdown could not confirm test process-group cleanup; the repository lock was retained');
  }

  private async execute(job: JobRecord): Promise<void> {
    let repo: LocalRepository | undefined;
    try {
      if (job.cancelRequested) {
        job.state = 'cancelled';
        job.finishedAt = now();
        return;
      }
      repo = new LocalRepository(this.root);
      if (job.cancelRequested) await Effect.runPromise(job.process.requestStop('SIGTERM'));
      job.state = job.cancelRequested ? 'cancelling' : 'running';
      const trace = buildTrace(repo, 'off', { includeCode: false });
      requireValidTrace(trace);
      const selected = selectCase(trace.annotations.cases, job.caseId);
      const exit = await Effect.runPromiseExit(runCase(repo, selected, trace.documents).pipe(Effect.provideService(OwnedProcess, job.process)));
      const results = await Effect.runPromise(job.process.cleanupResults);
      const idle = (await Effect.runPromise(job.process.activeCount)) === 0;
      const cleanupOk = idle && results.every(hasConfirmedOwnedGroupCleanup);
      if (!cleanupOk) {
        job.state = 'cleanup-failed';
        job.error = { code: 'CleanupFailed', message: 'The test command ended without confirmed owned process-group cleanup' };
        job.retainedRepository = repo;
        repo = undefined;
      } else if (Exit.isSuccess(exit)) {
        job.evidence = exit.value;
        job.state = exit.value.cancelled || job.cancelRequested ? 'cancelled' : 'completed';
      } else {
        const error = exitError(exit);
        job.error = { code: error.code, message: error.message };
        job.state = job.cancelRequested ? 'cancelled' : 'failed';
      }
    } catch (cause) {
      const results = await Effect.runPromise(job.process.cleanupResults);
      const idle = (await Effect.runPromise(job.process.activeCount)) === 0;
      if (!idle || !results.every(hasConfirmedOwnedGroupCleanup)) {
        job.state = 'cleanup-failed';
        job.error = { code: 'CleanupFailed', message: 'The job failed and process-group cleanup could not be confirmed' };
        if (repo !== undefined) {
          job.retainedRepository = repo;
          repo = undefined;
        }
      } else {
        const error = failure(cause);
        job.error = { code: error.code, message: error.message };
        job.state = job.cancelRequested ? 'cancelled' : 'failed';
      }
    } finally {
      if (job.state !== 'cleanup-failed') repo?.close();
      job.finishedAt ??= now();
      if (job.state !== 'cleanup-failed' && this.active === job) this.active = undefined;
      this.trim();
    }
  }

  private trim(): void {
    if (this.jobs.size <= 100) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= 100) break;
      if (job !== this.active && terminal.has(job.state)) this.jobs.delete(id);
    }
  }
}
