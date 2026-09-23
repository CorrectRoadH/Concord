// @concord-file
// @concord-implements docs/feature/project-onboarding/use-case/evolve-constitution.md
import { GitCompareArrows, Pencil, RefreshCw } from 'lucide-react';
import { Predicate, Schema } from 'effect';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { parseDocument } from 'yaml';
import type { ViewFile } from '../../src/view-contract';
import { ConstitutionSchema, LegacyConstitutionSchema } from '../../src/constitution-schema';
import { ApiError } from '../lib/api';
import { useWorkspace } from '../workspace';
import { RecordDetails, Surface } from './content-layout';
import { MarkdownPreview } from './markdown-preview';
import { Field } from './page';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface ConstitutionParts {
  readonly metadata: string;
  readonly body: string;
  readonly status: 'draft' | 'active';
}

function constitutionParts(source: string): ConstitutionParts | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (!match) return null;
  try {
    const yaml = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
    if (yaml.errors.length > 0) return null;
    const value: unknown = yaml.toJS({ maxAliasCount: 0 });
    if (!Predicate.isObject(value)) return null;
    const metadata = 'version' in value
      ? Schema.decodeUnknownSync(LegacyConstitutionSchema, { onExcessProperty: 'error' })(value)
      : Schema.decodeUnknownSync(ConstitutionSchema, { onExcessProperty: 'error' })(value);
    if ((metadata.status === 'draft') !== (metadata.ratifiedAt === null)) return null;
    return { metadata: match[1]!, body: match[2]!.replace(/^\r?\n/u, ''), status: metadata.status };
  } catch { return null; }
}

export function ConstitutionEditor({ initial, onSaved, toolbarTarget, onFollowLink }: {
  readonly initial: ViewFile;
  readonly onSaved?: (file: ViewFile) => void;
  readonly toolbarTarget?: HTMLElement | null;
  readonly onFollowLink?: (href: string) => boolean;
}) {
  const { api, refresh, notify, registerAutoSave, reportDirty, busy } = useWorkspace();
  const [file, setFile] = useState(initial);
  const baseline = useRef(initial);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(constitutionParts(initial.body)?.body ?? '');
  const [reason, setReason] = useState('');
  const [impact, setImpact] = useState('');
  const [sources, setSources] = useState('');
  const [external, setExternal] = useState<ViewFile | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState('');
  const savingNow = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const parts = constitutionParts(file.body);
  const dirty = editing && (body !== (constitutionParts(baseline.current.body)?.body ?? '') || reason.length > 0 || impact.length > 0 || sources.length > 0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const replaceWith = useCallback((next: ViewFile) => {
    baseline.current = next;
    setFile(next);
    setBody(constitutionParts(next.body)?.body ?? '');
    setReason(''); setImpact(''); setSources('');
    setExternal(null); setCompareOpen(false); setError(''); setNeedsReload(false);
    onSaved?.(next);
  }, [onSaved]);

  // The shared navigation guard asks the current draft owner to flush. A
  // constitution revision requires an explicit submit with its rationale.
  const owner = useMemo(() => ({
    flush: async () => {
      if (inFlight.current) await inFlight.current;
      if (dirtyRef.current) throw new Error('请先明确保存宪法修订，或丢弃草稿。');
    },
    isDirty: () => dirtyRef.current,
    discard: async () => {
      if (inFlight.current) await inFlight.current;
      if (dirtyRef.current) flushSync(() => { replaceWith(baseline.current); setEditing(false); });
    },
  }), [replaceWith]);
  useLayoutEffect(() => registerAutoSave(owner), [owner, registerAutoSave]);
  useLayoutEffect(() => { reportDirty(owner); }, [dirty, owner, reportDirty]);

  useEffect(() => {
    const controller = new AbortController();
    const id = window.setInterval(() => {
      void api.file(file.path, controller.signal).then(next => {
        if (savingNow.current || next.digest === baseline.current.digest) return;
        if (dirtyRef.current) setExternal(next);
        else replaceWith(next);
      }).catch(() => undefined);
    }, 6000);
    return () => { controller.abort(); window.clearInterval(id); };
  }, [api, file.path, replaceWith]);

  const reload = async () => {
    try {
      const next = await api.file(file.path);
      if (dirtyRef.current) { setExternal(next); setCompareOpen(true); return; }
      replaceWith(next);
      notify('已载入磁盘上的最新版本。', 'info');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const save = async () => {
    if (!parts || inFlight.current || busy || needsReload) return;
    if (external) { setCompareOpen(true); return; }
    const nextReason = reason.trim();
    const nextImpact = impact.trim();
    const nextSources = sources.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
    if (!body.trim() || !nextReason || !nextImpact) {
      setError('请填写宪法正文、修订原因和影响。');
      return;
    }
    const before = baseline.current;
    setSaving(true); savingNow.current = true; setError('');
    const pending = (async () => {
      let committed = false;
      try {
        await api.action({ action: parts.status === 'draft' ? 'constitution.adopt' : 'constitution.amend', body, reason: nextReason, impact: nextImpact, sources: nextSources, expectedDigest: before.digest });
        committed = true;
        // The action has committed. A later read failure must never present
        // this revision as a draft that can be discarded.
        flushSync(() => setEditing(false));
        const next = await api.file(before.path);
        flushSync(() => replaceWith(next));
        await refresh();
        notify(parts.status === 'draft' ? '宪法已采用。' : '宪法修订已保存。', 'success');
      } catch (cause) {
        if (committed) {
          setNeedsReload(true);
          setError('宪法修订已提交，但读取最新文件失败。请重新载入以确认内容。');
        } else if (cause instanceof ApiError && cause.status === 409) {
          const next = await api.file(before.path).catch(() => null);
          if (next) setExternal(next);
          setCompareOpen(true);
          setError(cause.message);
        } else {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally { savingNow.current = false; setSaving(false); }
    })();
    inFlight.current = pending;
    try { await pending; }
    finally { if (inFlight.current === pending) inFlight.current = null; }
  };

  const actions = <div className="toolbar-actions constitution-actions">
    {external && <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}><GitCompareArrows /> 外部变更</Button>}
    <Button variant="outline" size="sm" onClick={() => void reload()} disabled={saving}><RefreshCw /> 重新载入</Button>
    {editing ? <>
      <span role="status">{saving ? '正在保存…' : dirty ? '有未保存修订' : '编辑中'}</span>
      <Button variant="outline" size="sm" disabled={saving} onClick={() => dirty ? setDiscardOpen(true) : setEditing(false)}>取消编辑</Button>
      <Button size="sm" disabled={saving || busy || !dirty} onClick={() => void save()}>{parts?.status === 'draft' ? '采用宪法' : '保存修订'}</Button>
    </> : <>
      <span role="status">{saving ? '正在同步…' : needsReload ? '需要重新载入' : '阅读中'}</span>
      {parts && <Button variant="outline" size="sm" disabled={saving || needsReload} onClick={() => setEditing(true)}><Pencil /> 编辑宪法</Button>}
    </>}
  </div>;

  return <Surface className="constitution-editor" data-dirty={dirty}>
    {toolbarTarget ? createPortal(actions, toolbarTarget) : <div className="constitution-editor__bar">{actions}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {external && <p className="form-error" role="alert">磁盘内容已变化，草稿仍保留。请比较版本后继续。</p>}
    {!parts ? <div className="constitution-editor__invalid"><p role="alert">宪法 frontmatter 无法识别，不能在此编辑。</p><pre>{file.body}</pre></div> : editing ? <div className="constitution-editor__form">
      <p className="muted">只编辑正文。元数据与既有修订历史由宪法操作保管。</p>
      <Field label="宪法正文（Markdown）"><Textarea aria-label="宪法正文" className="raw-editor" value={body} readOnly={saving || busy} onChange={event => setBody(event.target.value)} /></Field>
      <div className="two-column">
        <Field label="修订原因"><Input aria-label="修订原因" value={reason} readOnly={saving || busy} onChange={event => setReason(event.target.value)} placeholder="为什么需要这次修订" /></Field>
        <Field label="影响"><Input aria-label="修订影响" value={impact} readOnly={saving || busy} onChange={event => setImpact(event.target.value)} placeholder="适用范围与受影响内容" /></Field>
      </div>
      <Field label="来源" hint="可选，每行一项"><Textarea aria-label="修订来源" value={sources} readOnly={saving || busy} onChange={event => setSources(event.target.value)} placeholder="docs/feature/…/README.md" /></Field>
    </div> : <MarkdownPreview markdown={parts.body} onFollowLink={onFollowLink} />}
    {parts && <div className="constitution-editor__metadata"><RecordDetails title="查看元数据与修订历史"><pre>{parts.metadata}</pre></RecordDetails></div>}
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
      <DialogContent className="dialog--wide"><DialogHeader><DialogTitle>比较宪法草稿</DialogTitle><DialogDescription>左侧是当前草稿，右侧是磁盘版本。重新载入会丢弃草稿与本次修订说明。</DialogDescription></DialogHeader>
        <div className="compare-grid"><div><strong>浏览器草稿</strong><pre>{body}</pre></div><div><strong>磁盘正文</strong><pre>{external ? constitutionParts(external.body)?.body ?? external.body : '无法读取最新版本'}</pre></div></div>
        <DialogFooter><Button variant="outline" onClick={() => setCompareOpen(false)}>继续编辑草稿</Button><Button variant="destructive" disabled={!external} onClick={() => { if (external) replaceWith(external); }}>丢弃草稿并载入</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <DialogContent><DialogHeader><DialogTitle>丢弃宪法草稿？</DialogTitle><DialogDescription>正文与本次修订说明都将恢复为已保存状态。</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>继续编辑</Button><Button variant="destructive" onClick={() => { replaceWith(baseline.current); setEditing(false); setDiscardOpen(false); }}>丢弃草稿</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Surface>;
}
