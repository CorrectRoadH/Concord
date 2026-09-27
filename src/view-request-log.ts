// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import type { IncomingMessage, ServerResponse } from 'node:http';

type Observation = 'incomplete-scan' | 'source-changed' | 'orphan-annotation' | 'cache-unavailable' | 'native-artifact-mismatch';
interface Phase { name: string; ms: number; count: number }
const rounded = (value: number): number => Math.round(Math.max(0, value) * 100) / 100;

/** Labels are application-owned; no URL query, body, path argument, or error message is retained. */
export class RequestTiming {
  private readonly phases = new Map<string, Phase>();
  readonly observations = new Set<Observation>();
  constructor(readonly started: number, private readonly now: () => number = performance.now.bind(performance)) {}
  sync<A>(name: string, operation: () => A): A {
    const started = this.now();
    try { return operation(); } finally { this.record(name, this.now() - started); }
  }
  async async<A>(name: string, operation: () => Promise<A>): Promise<A> {
    const started = this.now();
    try { return await operation(); } finally { this.record(name, this.now() - started); }
  }
  record(name: string, ms: number): void {
    const key = /^[a-zA-Z.]{1,64}$/u.test(name) && (this.phases.has(name) || this.phases.size < 16) ? name : 'other';
    const phase = this.phases.get(key) ?? { name: key, ms: 0, count: 0 };
    phase.ms += ms; phase.count++;
    this.phases.set(key, phase);
  }
  result(): readonly Phase[] { return [...this.phases.values()].map(phase => ({ ...phase, ms: rounded(phase.ms) })).sort((a, b) => b.ms - a.ms); }
  workspace(value: { complete?: boolean; findings: readonly { code: string }[]; cache: unknown }): void {
    if (value.complete === false) this.observations.add('incomplete-scan');
    if (value.findings.some(item => item.code === 'SourceChanged' || item.code === 'CodeSourceChanged')) this.observations.add('source-changed');
    if (value.findings.some(item => item.code === 'OrphanCodeAnnotation')) this.observations.add('orphan-annotation');
    this.cache(value.cache);
  }
  cache(value: unknown): void {
    if (typeof value === 'object' && value !== null && 'status' in value && value.status === 'unavailable') {
      this.observations.add('cache-unavailable');
      if ('detail' in value && typeof value.detail === 'string' && value.detail.startsWith('native binary digest differs')) this.observations.add('native-artifact-mismatch');
    }
  }
}

function routeLabel(target: string | undefined): string {
  const path = (target ?? '').split('?', 1)[0];
  if (['/api/workspace', '/api/jobs', '/api/action', '/api/file', '/api/git', '/api/git/diff'].includes(path!)) return path!;
  if (/^\/api\/jobs\/ccjob_[0-9a-f-]+$/u.test(path ?? '')) return '/api/jobs/:id';
  return path?.startsWith('/api/') ? '/api/unknown' : '/static';
}

/** Fixed rate and backpressure bounds; elapsed time starts at HTTP handler admission. */
export class ViewRequestLog {
  private tick: number;
  private recentLag = 0;
  private recentLagAt = 0;
  private window: number;
  private count = 0;
  private suppressed = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(
    private readonly write: (line: string) => boolean = line => {
      if (process.stderr.destroyed || process.stderr.errored || process.stderr.writableLength >= 64 * 1024) return false;
      process.stderr.write(line); return true;
    },
    private readonly now: () => number = performance.now.bind(performance),
    private readonly thresholdMs = 250,
  ) {
    this.tick = this.window = now();
    this.timer = setInterval(() => {
      const time = this.now();
      this.recentLag = Math.max(0, time - this.tick - 100);
      this.recentLagAt = time; this.tick = time;
    }, 100);
    this.timer.unref();
  }
  close(): void { clearInterval(this.timer); }
  private lag(): number {
    const now = this.now();
    return Math.max(0, now - this.tick - 100, now - this.recentLagAt <= 1000 ? this.recentLag : 0);
  }
  begin(request: IncomingMessage, response: ServerResponse): RequestTiming {
    const timing = new RequestTiming(this.now(), this.now);
    const admissionLag = this.lag();
    const route = routeLabel(request.url);
    const method = ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'].includes(request.method ?? '') ? request.method : 'OTHER';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      response.off('finish', finish); response.off('close', finish);
      const now = this.now(), durationMs = rounded(now - timing.started), eventLoopDelayMs = rounded(Math.max(admissionLag, this.lag()));
      if (durationMs < this.thresholdMs && eventLoopDelayMs < this.thresholdMs) return;
      if (now - this.window >= 60_000) { this.window = now; this.count = 0; }
      if (this.count >= 20) { this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1); return; }
      const phases = timing.result();
      const line = `Concord view slow request ${JSON.stringify({ method, route, status: response.statusCode, completed: response.writableFinished, durationMs, eventLoopDelayMs,
        phase: phases.find(phase => phase.name.startsWith('view.'))?.name ?? phases[0]?.name ?? 'response', reasons: [...timing.observations, ...(eventLoopDelayMs >= this.thresholdMs ? ['event-loop-delay-observed'] : [])], phases, suppressed: this.suppressed })}\n`;
      try {
        if (this.write(line)) { this.count++; this.suppressed = 0; }
        else this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1);
      } catch { this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1); }
    };
    response.once('finish', finish); response.once('close', finish);
    return timing;
  }
}
