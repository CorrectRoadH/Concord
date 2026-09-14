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

export class ConcordApi {
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
    let payload: ViewResponse<T>;
    try { payload = await response.json() as ViewResponse<T>; }
    catch { throw new ApiError(response.status, 'InvalidResponse', '服务返回了无法读取的响应。'); }
    if (!response.ok || !payload.ok) {
      const failure = payload as ViewFailure;
      throw new ApiError(response.status, failure.error, failure.message, failure.details);
    }
    return payload.value;
  }

  workspace(signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    return this.request('/api/workspace', { signal });
  }
  file(path: string, signal?: AbortSignal) {
    return this.request<import('../../src/view-contract').ViewFile>(`/api/file?path=${encodeURIComponent(path)}`, { signal });
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
