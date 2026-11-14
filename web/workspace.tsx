// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md
import '@fontsource-variable/noto-sans-sc/wght.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitStatus, ViewAction, WorkspaceProjection, WorkspaceProjectionSnapshot, WorkspaceProjectionStatus } from '../src/model/index.ts';
import type { ConcordApi } from './lib/api.ts';
import { ApiError } from './lib/api.ts';
import { Schema } from 'effect';
import { WorkspaceServerEvent } from '../src/model/index.ts';

interface Notice { readonly id: number; readonly tone: 'success' | 'error' | 'info'; readonly text: string }
export interface WorkspaceIssue { readonly code: string; readonly message: string; readonly hint?: string; readonly reason?: string }
export interface DraftOwner {
  flush(): Promise<void>;
  discard(): Promise<void>;
  isDirty(): boolean;
}
interface WorkspaceValue {
  readonly api: ConcordApi;
  readonly snapshot: WorkspaceProjectionSnapshot;
  readonly projection: WorkspaceProjectionStatus;
  readonly workspaceIssue: WorkspaceIssue | null;
  readonly refreshIssue: WorkspaceIssue | null;
  /** True until the next accepted result reflects a completed write. */
  readonly navigationUpdating: boolean;
  readonly git: GitStatus | null;
  readonly gitIssue: WorkspaceIssue | null;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly notices: readonly Notice[];
  reportDirty(owner: DraftOwner): void;
  registerAutoSave(owner: DraftOwner): () => void;
  flushAutoSave(): Promise<boolean>;
  discardAutoSave(): Promise<void>;
  refresh(): Promise<void>;
  /** Requests a merged write-level refresh and re-reads the served result. */
  requestRefresh(): Promise<void>;
  act(action: ViewAction, success?: string): Promise<unknown>;
  notify(text: string, tone?: Notice['tone']): void;
  clearNotice(id: number): void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

function message(cause: unknown): string {
  if (cause instanceof ApiError) return cause.status === 409 ? `内容已在外部变化：${cause.message}` : cause.message;
  return cause instanceof Error ? cause.message : String(cause);
}

function workspaceIssue(cause: unknown): WorkspaceIssue {
  const code = cause instanceof ApiError ? cause.code : 'OperationFailed';
  const text = cause instanceof Error ? cause.message : String(cause);
  const details = cause instanceof ApiError ? cause.details : undefined;
  const hint = typeof details === 'object' && details !== null && 'hint' in details && typeof details.hint === 'string'
    ? details.hint
    : undefined;
  const reason = typeof details === 'object' && details !== null && 'reason' in details && typeof details.reason === 'string'
    ? details.reason
    : undefined;
  return { code, message: text, ...(hint ? { hint } : {}), ...(reason ? { reason } : {}) };
}

function retryableProjection(issue: WorkspaceIssue | null): boolean {
  return issue?.code === 'WorkspaceProjectionPending' || issue?.code === 'WorkspaceProjectionUnavailable' && issue.reason === 'HawdbBusy';
}

/** Actions that change current sources and therefore request a navigation refresh. */
const mutatingActions: ReadonlySet<ViewAction['action']> = new Set([
  'init', 'recover',
  'document.create', 'document.set',
  'roadmap.start',
  'memory.link',
  'issue.unlink', 'issue.link', 'issue.edit', 'issue.remove', 'issue.close',
  'feedback.sync', 'feedback.link', 'source.set', 'config.set',
]);

export function WorkspaceProvider({ initial, api, children }: { initial: WorkspaceProjection; api: ConcordApi; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [projection, setProjection] = useState(initial.projection);
  const [workspaceProblem, setWorkspaceProblem] = useState<WorkspaceIssue | null>(null);
  const [refreshProblem, setRefreshProblem] = useState<WorkspaceIssue | null>(null);
  const [navigationUpdating, setNavigationUpdating] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [gitIssue, setGitIssue] = useState<WorkspaceIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const noticeId = useRef(0);
  const autoSave = useRef<DraftOwner | null>(null);
  const registerAutoSave = useCallback((owner: DraftOwner) => {
    if (autoSave.current && autoSave.current !== owner) throw new Error('Multiple active draft owners');
    autoSave.current = owner;
    setDirty(owner.isDirty());
    return () => { if (autoSave.current === owner) { autoSave.current = null; setDirty(false); } };
  }, []);
  const reportDirty = useCallback((owner: DraftOwner) => {
    if (autoSave.current === owner) setDirty(owner.isDirty());
  }, []);
  const flushAutoSave = useCallback(async () => {
    const owner = autoSave.current;
    if (!owner) return false;
    try { await owner.flush(); return autoSave.current === owner && !owner.isDirty(); } catch { return false; }
  }, []);
  const discardAutoSave = useCallback(async () => {
    const owner = autoSave.current;
    if (owner) await owner.discard();
  }, []);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    const id = ++noticeId.current;
    setNotices(items => [...items, { id, tone, text }]);
    window.setTimeout(() => setNotices(items => items.filter(item => item.id !== id)), 6000);
  }, []);
  const clearNotice = useCallback((id: number) => setNotices(items => items.filter(item => item.id !== id)), []);

  const refreshInFlight = useRef<Promise<void> | null>(null);
  const workspaceProblemRef = useRef<WorkspaceIssue | null>(null);
  const serverStoppedRef = useRef(false);
  workspaceProblemRef.current = workspaceProblem;
  const writtenAt = useRef(0);
  const lastGitReadAt = useRef(0);
  const applyProjection = useCallback((value: WorkspaceProjection) => {
    setSnapshot(value.snapshot);
    setProjection(value.projection);
    workspaceProblemRef.current = null;
    setWorkspaceProblem(null);
    const builtFrom = Date.parse(value.projection.builtFrom);
    if (writtenAt.current > 0 && (value.projection.status !== 'ready' || !Number.isNaN(builtFrom) && builtFrom >= writtenAt.current)) {
      writtenAt.current = 0;
      setNavigationUpdating(false);
    }
  }, []);

  const readWorkspace = useCallback(async (): Promise<WorkspaceProjection | null> => {
    try {
      const value = await api.workspace();
      if (serverStoppedRef.current) return null;
      applyProjection(value);
      return value;
    } catch (cause) {
      if (serverStoppedRef.current) return null;
      const problem = workspaceIssue(cause);
      workspaceProblemRef.current = problem;
      setWorkspaceProblem(problem);
      if (!retryableProjection(problem)) {
        writtenAt.current = 0;
        setNavigationUpdating(false);
      }
      return null;
    }
  }, [api, applyProjection]);

  const refresh = useCallback(async ({ includeWorkspace = true, includeGit = true } = {}) => {
    // A refresh requested after a write must read after any older refresh finishes.
    while (refreshInFlight.current) await refreshInFlight.current;
    // Git status also loads workspace metadata on the server. Keep it behind the
    // workspace request so one browser refresh cannot contend with itself.
    const pending = (async () => {
      const value = includeWorkspace ? await readWorkspace() : initial;
      const tasks: Promise<unknown>[] = [];
      if (includeGit && value) {
        lastGitReadAt.current = Date.now();
        tasks.push(api.git().then(result => { setGit(result); setGitIssue(null); }, cause => { setGit(null); setGitIssue(workspaceIssue(cause)); }));
      }
      await Promise.allSettled(tasks);
    })();
    refreshInFlight.current = pending;
    try { await pending; }
    finally { if (refreshInFlight.current === pending) refreshInFlight.current = null; }
  }, [api, initial, readWorkspace]);

  const requestRefresh = useCallback(async () => {
    writtenAt.current = Date.now();
    setNavigationUpdating(true);
    try { await api.requestWorkspaceRefresh(); setRefreshProblem(null); }
    catch (cause) { setRefreshProblem(workspaceIssue(cause)); }
    await refresh();
  }, [api, refresh]);

  useEffect(() => {
    let stopped = false;
    let serverStopped = false;
    let connected = false;
    let timer: number | undefined;
    let firstEvent = true;
    const events = new EventSource('/api/events');
    events.onopen = () => { connected = true; };
    events.onerror = () => {
      if (connected) { connected = false; window.clearTimeout(timer); timer = window.setTimeout(() => void poll(), 4000); }
    };
    const onEvent = (message: MessageEvent<string>) => {
      let event: typeof WorkspaceServerEvent.Type;
      try { event = Schema.decodeUnknownSync(Schema.fromJsonString(WorkspaceServerEvent), { onExcessProperty: 'error' })(message.data); }
      catch { connected = false; return; }
      if (event.state === 'stopping') {
        serverStopped = true; serverStoppedRef.current = true; connected = false; events.close(); window.clearTimeout(timer);
        const problem = { code: 'WorkspaceServerStopped', message: '服务已停止，请重新运行 concord view。' };
        workspaceProblemRef.current = problem; setWorkspaceProblem(problem); return;
      }
      const sameInitial = firstEvent && event.sourceDigest === initial.projection.sourceDigest
        && event.error === undefined && JSON.stringify(event.workspace?.projection ?? event.projection) === JSON.stringify(initial.projection);
      firstEvent = false;
      if (!sameInitial) void refresh({ includeWorkspace: true, includeGit: false });
    };
    events.addEventListener('workspace', onEvent);
    events.addEventListener('stopping', onEvent);
    const poll = async (initial = false) => {
      if (serverStopped) return;
      // Workspace GET reads the published cache. Pending reads retry faster,
      // while Git retains its own cadence through the same queue.
      const now = Date.now();
      await refresh({
        includeWorkspace: !connected && !initial || retryableProjection(workspaceProblemRef.current),
        includeGit: initial || now - lastGitReadAt.current >= 32_000,
      });
      if (!stopped && !serverStopped) timer = window.setTimeout(() => void poll(), retryableProjection(workspaceProblemRef.current) ? 2000 : connected ? 32_000 : 4000);
    };
    // App has just loaded the workspace; only fetch the remaining panels now.
    void poll(true);
    return () => { stopped = true; window.clearTimeout(timer); events.close(); };
  }, [refresh]);

  const act = useCallback(async (action: ViewAction, success = '操作已完成。') => {
    setBusy(true);
    try {
      const result = await api.action(action);
      if (mutatingActions.has(action.action)) await requestRefresh();
      else await refresh();
      if (action.action === 'recover' && typeof result === 'object' && result !== null && 'status' in result && result.status === 'blocked') {
        notify('恢复仍被阻塞，现场已保留。请查看恢复结果中的诊断。', 'error');
      } else notify(success, 'success');
      return result;
    } catch (cause) {
      notify(message(cause), 'error');
      throw cause;
    } finally { setBusy(false); }
  }, [api, notify, refresh, requestRefresh]);

  const value = useMemo<WorkspaceValue>(() => ({ api, snapshot, projection, workspaceIssue: workspaceProblem, refreshIssue: refreshProblem, navigationUpdating, git, gitIssue, busy, dirty, notices, reportDirty, registerAutoSave, flushAutoSave, discardAutoSave, refresh, requestRefresh, act, notify, clearNotice }), [api, snapshot, projection, workspaceProblem, refreshProblem, navigationUpdating, git, gitIssue, busy, dirty, notices, reportDirty, registerAutoSave, flushAutoSave, discardAutoSave, refresh, requestRefresh, act, notify, clearNotice]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is unavailable.');
  return value;
}

export { projectionIsConclusive } from './lib/workspace-display.ts';
