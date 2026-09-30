// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import '@fontsource-variable/noto-sans-sc/wght.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitStatus, ViewAction, ViewJob, WorkspaceProjection, WorkspaceProjectionSnapshot, WorkspaceProjectionStatus } from '../src/view-contract';
import { ApiError, ConcordApi } from './lib/api';

interface Notice { readonly id: number; readonly tone: 'success' | 'error' | 'info'; readonly text: string }
export interface WorkspaceIssue { readonly code: string; readonly message: string; readonly hint?: string }
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
  /** True until the next published generation reflects a completed write. */
  readonly navigationUpdating: boolean;
  readonly git: GitStatus | null;
  readonly gitIssue: WorkspaceIssue | null;
  readonly jobs: readonly ViewJob[];
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly notices: readonly Notice[];
  reportDirty(owner: DraftOwner): void;
  registerAutoSave(owner: DraftOwner): () => void;
  flushAutoSave(): Promise<boolean>;
  discardAutoSave(): Promise<void>;
  refresh(): Promise<void>;
  /** Requests a merged write-level refresh and re-reads the served generation. */
  requestRefresh(): Promise<void>;
  act(action: ViewAction, success?: string): Promise<unknown>;
  runCase(caseId: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
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
  return { code, message: text, ...(hint ? { hint } : {}) };
}

/** Actions that change current sources and therefore request a navigation refresh. */
const mutatingActions: ReadonlySet<ViewAction['action']> = new Set([
  'init', 'recover',
  'document.create', 'document.set', 'document.metadata',
  'page.add', 'roadmap.adopt', 'design.decide', 'design.correct-reason', 'design.format',
  'memory.resolve', 'memory.edit', 'memory.activate', 'memory.reopen', 'memory.supersede', 'memory.promote', 'memory.retire',
  'issue.link', 'issue.edit', 'issue.remove', 'issue.close',
  'feedback.sync', 'feedback.link', 'source.set', 'writing.set', 'concepts.set', 'config.set',
  'constitution.initialize', 'constitution.adopt', 'constitution.amend',
]);

export function WorkspaceProvider({ initial, api, children }: { initial: WorkspaceProjection; api: ConcordApi; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const [projection, setProjection] = useState(initial.projection);
  const [workspaceProblem, setWorkspaceProblem] = useState<WorkspaceIssue | null>(null);
  const [refreshProblem, setRefreshProblem] = useState<WorkspaceIssue | null>(null);
  const [navigationUpdating, setNavigationUpdating] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [gitIssue, setGitIssue] = useState<WorkspaceIssue | null>(null);
  const [jobs, setJobs] = useState<readonly ViewJob[]>([]);
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
  workspaceProblemRef.current = workspaceProblem;
  const writtenAt = useRef(0);
  const navigationUpdatingRef = useRef(false);
  navigationUpdatingRef.current = navigationUpdating;
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
      applyProjection(value);
      return value;
    } catch (cause) {
      const problem = workspaceIssue(cause);
      workspaceProblemRef.current = problem;
      setWorkspaceProblem(problem);
      if (problem.code !== 'WorkspaceProjectionPending') {
        writtenAt.current = 0;
        setNavigationUpdating(false);
      }
      return null;
    }
  }, [api, applyProjection]);

  const refresh = useCallback(async (includeWorkspace = true) => {
    // A refresh requested after a write must read after any older refresh finishes.
    while (refreshInFlight.current) await refreshInFlight.current;
    // Git status also loads workspace metadata on the server. Keep it behind the
    // workspace request so one browser refresh cannot contend with itself.
    const pending = (async () => {
      const value = includeWorkspace ? await readWorkspace() : initial;
      const tasks: Promise<unknown>[] = [api.jobs().then(setJobs)];
      if (value) tasks.push(api.git().then(result => { setGit(result); setGitIssue(null); }, cause => { setGit(null); setGitIssue(workspaceIssue(cause)); }));
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
    let timer: number | undefined;
    let cycle = 0;
    const poll = async (initial = false) => {
      cycle += initial ? 0 : 1;
      // Jobs are cheap and need responsive state. Workspace/Git scans are much
      // heavier, especially in large dirty worktrees, so refresh them every
      // eighth cycle instead of keeping the repository lock almost continuous.
      // While a write is still waiting for its generation, poll it every cycle.
      const pending = workspaceProblemRef.current?.code === 'WorkspaceProjectionPending';
      if (pending || !initial && (cycle % 8 === 0 || navigationUpdatingRef.current)) await refresh(true);
      else if (initial) await refresh(false);
      else await api.jobs().then(setJobs).catch(() => undefined);
      if (!stopped) timer = window.setTimeout(() => void poll(), workspaceProblemRef.current?.code === 'WorkspaceProjectionPending' ? 2000 : 4000);
    };
    // App has just loaded the workspace; only fetch the remaining panels now.
    void poll(true);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [api, refresh]);

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

  const runCase = useCallback(async (caseId: string) => {
    setBusy(true);
    try { const job = await api.run(caseId); setJobs(items => [job, ...items.filter(item => item.id !== job.id)]); notify('测试任务已进入队列。', 'success'); }
    catch (cause) { notify(message(cause), 'error'); }
    finally { setBusy(false); }
  }, [api, notify]);
  const cancelJob = useCallback(async (id: string) => {
    try { const job = await api.cancel(id); setJobs(items => items.map(item => item.id === id ? job : item)); notify('已请求安全终止测试。', 'info'); }
    catch (cause) { notify(message(cause), 'error'); }
  }, [api, notify]);

  const value = useMemo<WorkspaceValue>(() => ({ api, snapshot, projection, workspaceIssue: workspaceProblem, refreshIssue: refreshProblem, navigationUpdating, git, gitIssue, jobs, busy, dirty, notices, reportDirty, registerAutoSave, flushAutoSave, discardAutoSave, refresh, requestRefresh, act, runCase, cancelJob, notify, clearNotice }), [api, snapshot, projection, workspaceProblem, refreshProblem, navigationUpdating, git, gitIssue, jobs, busy, dirty, notices, reportDirty, registerAutoSave, flushAutoSave, discardAutoSave, refresh, requestRefresh, act, runCase, cancelJob, notify, clearNotice]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is unavailable.');
  return value;
}

/** Whether this generation can support absence and relationship conclusions. */
export function projectionIsConclusive(projection: WorkspaceProjectionStatus): boolean {
  return projection.status === 'ready' && projection.consistent && projection.complete && !projection.unknownRelations;
}
