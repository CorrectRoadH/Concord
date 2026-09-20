import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useWorkspace } from '../workspace';

/** Serializes saves and flushes the latest revision before navigation. */
export function useAutoSave({ dirty, revision, save, discard, enabled = true }: {
  dirty: boolean;
  revision: string;
  /** Resolves after committing the saved baseline, preserving newer edits. */
  save(): Promise<void>;
  discard(): void;
  enabled?: boolean;
}) {
  const { registerAutoSave, reportDirty } = useWorkspace();
  const latest = useRef({ dirty, revision, save, discard, enabled });
  latest.current = { dirty, revision, save, discard, enabled };
  const active = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef<Promise<void> | null>(null);
  const saved = useRef<string | null>(null);
  const attempted = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const operation = async () => {
      setSaving(true); setError('');
      try {
        while (active.current && latest.current.dirty && saved.current !== latest.current.revision) {
          const current = latest.current;
          if (!current.enabled) throw new Error('当前内容无法自动保存。');
          attempted.current = current.revision;
          await current.save();
          saved.current = current.revision;
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally { setSaving(false); }
    };
    inFlight.current = operation().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, []);
  const owner = useMemo(() => ({
    flush,
    isDirty: () => active.current && latest.current.dirty,
    discard: async () => {
      window.clearTimeout(timer.current);
      if (inFlight.current) await inFlight.current.catch(() => undefined);
      attempted.current = latest.current.revision;
      flushSync(() => latest.current.discard());
      setError('');
    },
  }), [flush]);
  useLayoutEffect(() => {
    if (!enabled) return;
    active.current = true;
    const unregister = registerAutoSave(owner);
    return () => { active.current = false; window.clearTimeout(timer.current); unregister(); };
  }, [enabled, registerAutoSave, owner]);
  useLayoutEffect(() => { reportDirty(owner); }, [dirty, owner, reportDirty]);
  useEffect(() => {
    if (!dirty) { saved.current = null; attempted.current = null; setError(''); return; }
    if (!enabled || attempted.current === revision) return;
    timer.current = window.setTimeout(() => { void flush().catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer.current);
  }, [dirty, revision, enabled, flush]);
  return { saving, error, flush, status: saving ? '保存中…' : error ? '自动保存失败' : dirty ? '等待自动保存…' : '已自动保存' };
}
