// @concord-file workbench-live-workspace
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import '@fontsource-variable/noto-sans-sc/wght.css';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GitStatus, ViewAction, ViewJob, WorkspaceSnapshot } from '../src/view-contract';
import { ApiError, ConcordApi } from './lib/api';

interface Notice { readonly id: number; readonly tone: 'success' | 'error' | 'info'; readonly text: string }
interface WorkspaceValue {
  readonly api: ConcordApi;
  readonly snapshot: WorkspaceSnapshot;
  readonly git: GitStatus | null;
  readonly jobs: readonly ViewJob[];
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly notices: readonly Notice[];
  setDirty(value: boolean): void;
  registerAutoSave(flush: () => Promise<void>): () => void;
  flushAutoSave(): Promise<boolean>;
  refresh(): Promise<void>;
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

export function WorkspaceProvider({ initial, children }: { initial: WorkspaceSnapshot; children: ReactNode }) {
  const api = useMemo(() => new ConcordApi(), []);
  const [snapshot, setSnapshot] = useState(initial);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [jobs, setJobs] = useState<readonly ViewJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const noticeId = useRef(0);
  const autoSave = useRef<(() => Promise<void>) | null>(null);
  const registerAutoSave = useCallback((flush: () => Promise<void>) => {
    autoSave.current = flush;
    return () => { if (autoSave.current === flush) autoSave.current = null; };
  }, []);
  const flushAutoSave = useCallback(async () => {
    if (!autoSave.current) return false;
    try { await autoSave.current(); return true; } catch { return false; }
  }, []);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    const id = ++noticeId.current;
    setNotices(items => [...items, { id, tone, text }]);
    window.setTimeout(() => setNotices(items => items.filter(item => item.id !== id)), 6000);
  }, []);
  const clearNotice = useCallback((id: number) => setNotices(items => items.filter(item => item.id !== id)), []);

  const refresh = useCallback(async () => {
    const [next, nextGit, nextJobs] = await Promise.allSettled([api.workspace(), api.git(), api.jobs()]);
    if (next.status === 'fulfilled') setSnapshot(next.value);
    if (nextGit.status === 'fulfilled') setGit(nextGit.value);
    if (nextJobs.status === 'fulfilled') setJobs(nextJobs.value);
  }, [api]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const act = useCallback(async (action: ViewAction, success = '操作已完成。') => {
    setBusy(true);
    try {
      const result = await api.action(action);
      await refresh();
      notify(success, 'success');
      return result;
    } catch (cause) {
      notify(message(cause), 'error');
      throw cause;
    } finally { setBusy(false); }
  }, [api, notify, refresh]);

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

  const value = useMemo<WorkspaceValue>(() => ({ api, snapshot, git, jobs, busy, dirty, notices, setDirty, registerAutoSave, flushAutoSave, refresh, act, runCase, cancelJob, notify, clearNotice }), [api, snapshot, git, jobs, busy, dirty, notices, registerAutoSave, flushAutoSave, refresh, act, runCase, cancelJob, notify, clearNotice]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace context is unavailable.');
  return value;
}
