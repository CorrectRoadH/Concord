// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#服务托管
import { ConcordError, type ViewJob } from '../../model/index.ts';

interface Job { value: ViewJob; controller: AbortController; task: Promise<void> }
/** The slot belongs to the service; the operation process owns execution. */
export class ServerJobs {
  private readonly jobs = new Map<string, Job>();
  private active: Job | undefined;
  private stopping = false;
  private readonly run: (caseId: string, signal: AbortSignal) => Promise<unknown>;
  private readonly changed: () => void;
  constructor(run: (caseId: string, signal: AbortSignal) => Promise<unknown>, changed: () => void) {
    this.run = run;
    this.changed = changed;
  }
  list() { return [...this.jobs.values()].map(job => job.value).reverse(); }
  start(caseId: string): ViewJob {
    if (this.stopping) throw new ConcordError('ServerStopping', 'The service is stopping');
    if (this.active) throw new ConcordError(this.active.value.state === 'cleanup-failed' ? 'CleanupFailed' : 'JobBusy', 'Only one test job may run at a time');
    const id = `ccjob_${crypto.randomUUID()}`;
    const value: ViewJob = { id, caseId, state: 'queued', startedAt: new Date().toISOString() };
    const job: Job = { value, controller: new AbortController(), task: Promise.resolve() };
    this.jobs.set(id, job); this.active = job;
    job.task = Promise.resolve().then(async () => {
      job.value = { ...job.value, state: 'running' }; this.changed();
      try {
        const evidence = await this.run(caseId, job.controller.signal);
        job.value = { ...job.value, state: job.controller.signal.aborted ? 'cancelled' : 'completed', evidence: evidence as ViewJob['evidence'], finishedAt: new Date().toISOString() };
      } catch (cause) {
        const code = cause instanceof ConcordError ? cause.code : 'JobFailed';
        job.value = { ...job.value, state: code === 'CleanupFailed' ? 'cleanup-failed' : job.controller.signal.aborted ? 'cancelled' : 'failed', error: { code, message: cause instanceof Error ? cause.message : String(cause) }, finishedAt: new Date().toISOString() };
      } finally {
        if (job.value.state !== 'cleanup-failed') this.active = undefined;
        this.changed();
      }
    });
    while (this.jobs.size > 100) { const oldest = this.jobs.keys().next().value; if (oldest) this.jobs.delete(oldest); }
    this.changed(); return value;
  }
  cancel(id: string): ViewJob {
    const job = this.jobs.get(id);
    if (!job) throw new ConcordError('JobNotFound', `No test job has ID ${id}`);
    if (['queued', 'running', 'cancelling'].includes(job.value.state)) {
      job.value = { ...job.value, state: 'cancelling' }; job.controller.abort(); this.changed();
    }
    return job.value;
  }
  async close() {
    this.stopping = true;
    if (this.active) { this.cancel(this.active.value.id); await this.active.task; }
    if (this.active?.value.state === 'cleanup-failed') throw new ConcordError('CleanupFailed', 'Job process group cleanup is unconfirmed');
  }
}
