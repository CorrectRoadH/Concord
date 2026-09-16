import type {
  GitDiff,
  GitStatus,
  ViewAction,
  ViewFailure,
  ViewJob,
  ViewResponse,
  WorkspaceSnapshot,
} from '../../src/view-contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) { super(message); }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export class ConcordApi {
  private readonly workspaceCache: { current?: { etag: string; value: WorkspaceSnapshot } } = {};

  private async request<T>(path: string, init?: RequestInit, cache?: { current?: { etag: string; value: T } }): Promise<T> {
    const headers = new Headers(init?.headers);
    const cached = cache?.current;
    if (cached) headers.set('If-None-Match', cached.etag);
    if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    if (response.status === 304 && cached) return cached.value;
    let payload: ViewResponse<T>;
    try { payload = await response.json() as ViewResponse<T>; }
    catch { throw new ApiError(response.status, 'InvalidResponse', '服务返回了无法读取的响应。'); }
    if (!response.ok || !payload.ok) {
      const failure = payload as ViewFailure;
      throw new ApiError(response.status, failure.error, failure.message, failure.details);
    }
    const etag = response.headers.get('ETag');
    if (cache && etag) cache.current = { etag, value: payload.value };
    return payload.value;
  }

  workspace(signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    return this.request('/api/workspace', { signal }, this.workspaceCache);
  }
  async file(path: string, signal?: AbortSignal) {
    const endpoint = `/api/file?path=${encodeURIComponent(path)}`;
    const waits = [100, 250, 500, 1000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.request<import('../../src/view-contract').ViewFile>(endpoint, { signal });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.code !== 'RepositoryBusy' || attempt >= waits.length) throw cause;
        await delay(waits[attempt]!, signal);
      }
    }
  }
  action(action: ViewAction): Promise<unknown> {
    return this.request('/api/action', { method: 'POST', body: JSON.stringify(action) });
  }
  jobs(signal?: AbortSignal): Promise<readonly ViewJob[]> { return this.request('/api/jobs', { signal }); }
  run(caseId: string): Promise<ViewJob> { return this.request('/api/jobs', { method: 'POST', body: JSON.stringify({ caseId }) }); }
  cancel(id: string): Promise<ViewJob> { return this.request(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  git(signal?: AbortSignal): Promise<GitStatus> { return this.request('/api/git', { signal }); }
  gitDiff(path: string, area: 'staged' | 'unstaged' | 'untracked', signal?: AbortSignal): Promise<GitDiff> {
    return this.request(`/api/git/diff?path=${encodeURIComponent(path)}&area=${area}`, { signal });
  }
}
