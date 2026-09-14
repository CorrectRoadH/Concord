import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../workspace';

/** Serializes saves and flushes the latest revision before navigation. */
export function useAutoSave({ dirty, revision, save, enabled = true }: {
  dirty: boolean;
  revision: string;
  save(): Promise<void>;
  enabled?: boolean;
}) {
  const { registerAutoSave } = useWorkspace();
  const latest = useRef({ dirty, revision, save, enabled });
  latest.current = { dirty, revision, save, enabled };
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
        while (latest.current.dirty && saved.current !== latest.current.revision) {
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
  useEffect(() => registerAutoSave(flush), [registerAutoSave, flush]);
  useEffect(() => {
    if (!dirty) { saved.current = null; attempted.current = null; setError(''); return; }
    if (!enabled || attempted.current === revision) return;
    const timer = window.setTimeout(() => { void flush().catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer);
  }, [dirty, revision, enabled, flush]);
  return { saving, error, flush, status: saving ? '保存中…' : error ? '自动保存失败' : dirty ? '等待自动保存…' : '已自动保存' };
}
