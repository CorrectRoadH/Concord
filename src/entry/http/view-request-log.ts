// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#项目测试只读投影
import { rounded, RequestTiming } from "../../app/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";

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
        phase: phases.find(phase => phase.name.startsWith('view.'))?.name ?? phases[0]?.name ?? 'response', reasons: [...timing.observations, ...(eventLoopDelayMs >= this.thresholdMs ? ['event-loop-delay-observed'] : [])], phases, caches: timing.caches, suppressed: this.suppressed })}\n`;
      try {
        if (this.write(line)) { this.count++; this.suppressed = 0; }
        else this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1);
      } catch { this.suppressed = Math.min(Number.MAX_SAFE_INTEGER, this.suppressed + 1); }
    };
    response.once('finish', finish); response.once('close', finish);
    return timing;
  }
}
