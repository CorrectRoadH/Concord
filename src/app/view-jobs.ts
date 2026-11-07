import { RuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../base/environment/index.ts';
import { Publication } from '../base/publication/index.ts';
import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Option } from "effect";
import { runCase } from "../domain/tests/index.ts";
import { hasConfirmedOwnedGroupCleanup, makeOwnedProcessService, OwnedProcess, type OwnedProcessService } from "../base/process/index.ts";
import { ConcordError, failure } from "../model/index.ts";
import type { LocalRepository } from "../base/workspace/index.ts";
import { Sources } from '../base/sources/index.ts';
import { buildTrace, requireValidTrace, selectCase } from "../domain/trace/index.ts";
import type { ViewJob, ViewJobState } from "../model/index.ts";


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


/** Server-owned single-slot job runner. Runner coordination owns child-process cleanup independently of document snapshots. */
export class ViewJobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private active: JobRecord | undefined;
  private stopped = false;

  readonly root: string;
  private readonly runtime: RuntimeEnvironmentSnapshot;
  private readonly onEvidencePublished: () => void;
  private readonly withWriter: <A>(root: string, use: (repo: LocalRepository, sources: Sources['Service'], publication: Publication['Service']) => Promise<A>) => Promise<A>;
  constructor(root: string, onEvidencePublished: () => void, withWriter: <A>(root: string, use: (repo: LocalRepository, sources: Sources['Service'], publication: Publication['Service']) => Promise<A>) => Promise<A>, runtime: RuntimeEnvironmentSnapshot) {
    this.root = root;
    this.runtime = runtime;
    this.onEvidencePublished = onEvidencePublished;
    this.withWriter = withWriter;
  }

  list(): readonly ViewJob[] {
    return [...this.jobs.values()].map(publicJob).reverse();
  }

  start(caseId: string): ViewJob {
    if (!caseId || caseId.trim() !== caseId) throw new ConcordError('InvalidInput', 'caseId must be non-empty and have no surrounding whitespace');
    if (this.stopped) throw new ConcordError('ServerStopping', 'The view server is stopping');
    if (this.active !== undefined) {
      if (this.active.state === 'cleanup-failed') throw new ConcordError('CleanupFailed', 'A previous job could not confirm process-group cleanup; inspect its persistent runner state before restarting');
      throw new ConcordError('JobBusy', 'Only one test job may run at a time');
    }
    const job: JobRecord = {
      id: `ccjob_${randomUUID()}`,
      caseId,
      state: 'queued',
      startedAt: now(),
      cancelRequested: false,
      process: makeOwnedProcessService({ environment: this.runtime }),
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
    if (job.state === 'cleanup-failed') throw new ConcordError('CleanupFailed', 'Server shutdown could not confirm test process-group cleanup; persistent runner quarantine was retained');
  }

  private async execute(job: JobRecord): Promise<void> {
    try {
      if (job.cancelRequested) {
        job.state = 'cancelled';
        job.finishedAt = now();
        return;
      }
      await this.withWriter(this.root, async (repo, sources, publication) => {
      if (job.cancelRequested) await Effect.runPromise(job.process.requestStop('SIGTERM'));
      job.state = job.cancelRequested ? 'cancelling' : 'running';
      const trace = (await repo.snapshot(async () => (await buildTrace(repo, 'off', { includeCode: false }))));
      requireValidTrace(trace);
      const selected = selectCase(trace.annotations.cases, job.caseId);
      const exit = await Effect.runPromiseExit(runCase(repo, selected, trace.documents).pipe(Effect.provideService(OwnedProcess, job.process), Effect.provideService(Sources, sources), Effect.provideService(Publication, publication), Effect.provideService(RuntimeEnvironment, this.runtime)));
      const results = await Effect.runPromise(job.process.cleanupResults);
      const idle = (await Effect.runPromise(job.process.activeCount)) === 0;
      const cleanupOk = idle && results.every(hasConfirmedOwnedGroupCleanup);
      if (!cleanupOk) {
        job.state = 'cleanup-failed';
        job.error = { code: 'CleanupFailed', message: 'The test command ended without confirmed owned process-group cleanup' };
      } else if (Exit.isSuccess(exit)) {
        job.evidence = exit.value;
        job.state = exit.value.cancelled || job.cancelRequested ? 'cancelled' : 'completed';
      } else {
        const error = exitError(exit);
        job.error = { code: error.code, message: error.message };
        job.state = job.cancelRequested ? 'cancelled' : 'failed';
      }
      });
    } catch (cause) {
      const results = await Effect.runPromise(job.process.cleanupResults);
      const idle = (await Effect.runPromise(job.process.activeCount)) === 0;
      if (!idle || !results.every(hasConfirmedOwnedGroupCleanup)) {
        job.state = 'cleanup-failed';
        job.error = { code: 'CleanupFailed', message: 'The job failed and process-group cleanup could not be confirmed' };
      } else {
        const error = failure(cause);
        job.error = { code: error.code, message: error.message };
        job.state = job.cancelRequested ? 'cancelled' : 'failed';
      }
    } finally {
      if (job.evidence !== undefined) this.onEvidencePublished();
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
