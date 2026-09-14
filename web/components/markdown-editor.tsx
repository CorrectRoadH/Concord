// @concord-file workbench-markdown-editor
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import {
  MDXEditor,
  CodeMirrorEditor,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
} from '@mdxeditor/editor';
import type { CodeBlockEditorProps } from '@mdxeditor/editor';
import * as stylex from '@stylexjs/stylex';
import { AlertTriangle, GitCompareArrows, RefreshCw } from 'lucide-react';
import { Component, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ViewFile } from '../../src/view-contract';
import { ApiError } from '../lib/api';
import { useAutoSave } from '../hooks/use-auto-save';
import { useWorkspace } from '../workspace';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';

interface Props {
  readonly initial: ViewFile;
  readonly source?: boolean;
  readonly title?: string;
  readonly onSaved?: (file: ViewFile) => void;
  readonly toolbarTarget?: HTMLElement | null;
}

interface MarkdownErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly onError: (error: Error) => void;
}

const markdownStyles = stylex.create({
  mermaidEditor: { display: 'grid', gap: 12 },
  mermaidPreview: {
    overflowX: 'auto',
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    textAlign: 'center',
  },
  mermaidSvg: { display: 'block', maxWidth: '100%', marginInline: 'auto' },
  mermaidError: { margin: 0, color: 'var(--destructive)', textAlign: 'left', whiteSpace: 'pre-wrap' },
});

function MermaidCodeBlockEditor(props: CodeBlockEditorProps) {
  const reactId = useId().replaceAll(':', '');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<'default' | 'dark'>(() => document.documentElement.classList.contains('dark') ? 'dark' : 'default');

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'default'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
      const rendered = await mermaid.render(`concord-mermaid-${reactId}`, props.code);
      if (!cancelled) { setSvg(rendered.svg); setError(''); }
    }).catch(cause => {
      if (!cancelled) { setSvg(''); setError(cause instanceof Error ? cause.message : String(cause)); }
    });
    return () => { cancelled = true; };
  }, [props.code, reactId, theme]);

  return <div data-testid="mermaid-editor" {...stylex.props(markdownStyles.mermaidEditor)}>
    <div aria-label="Mermaid 图表预览" {...stylex.props(markdownStyles.mermaidPreview)}>
      {svg ? <div {...stylex.props(markdownStyles.mermaidSvg)} dangerouslySetInnerHTML={{ __html: svg }} /> : error ? <pre {...stylex.props(markdownStyles.mermaidError)}>{error}</pre> : <span role="status">正在渲染图表…</span>}
    </div>
    <CodeMirrorEditor {...props} />
  </div>;
}

const mermaidCodeBlockDescriptor = {
  priority: 100,
  match: (language: string | null | undefined) => language?.toLowerCase() === 'mermaid',
  Editor: MermaidCodeBlockEditor,
};

class MarkdownErrorBoundary extends Component<MarkdownErrorBoundaryProps, { readonly failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function MarkdownEditor({ initial, source = false, title, onSaved, toolbarTarget }: Props) {
  const { api, refresh, setDirty, notify, snapshot, busy } = useWorkspace();
  const [file, setFile] = useState(initial);
  const [draft, setDraft] = useState(initial.body);
  const [dirty, setLocalDirty] = useState(false);
  const baseline = useRef(initial);
  const currentDraft = useRef(initial.body);
  const savingNow = useRef(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [external, setExternal] = useState<ViewFile | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(initial.digest);
  const currentDocument = snapshot.documents.find(document => document.path === initial.path);
  const observed = snapshot.pages.find(page => page.path === initial.path)
    ?? (currentDocument ? { path: currentDocument.path, body: currentDocument.body, digest: currentDocument.digest, readOnly: false, documentPath: currentDocument.path } : undefined);
  const observedDigest = useRef(observed?.digest);

  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);

  useEffect(() => {
    const controller = new AbortController();
    const id = window.setInterval(() => {
      void api.file(file.path, controller.signal).then(next => {
        if (savingNow.current || next.digest === baseline.current.digest) return;
        if (dirty) setExternal(next);
        else {
          baseline.current = next; currentDraft.current = next.body;
          setFile(next); setDraft(next.body); setEditorKey(next.digest); setUnsupported(null);
        }
      }).catch(() => undefined);
    }, 6000);
    return () => { controller.abort(); window.clearInterval(id); };
  }, [api, dirty, file.digest, file.path]);

  const replaceWith = useCallback((next: ViewFile) => {
    baseline.current = next; currentDraft.current = next.body;
    setFile(next); setDraft(next.body); setLocalDirty(false); setExternal(null);
    setUnsupported(null); setEditorKey(next.digest); onSaved?.(next);
  }, [onSaved]);

  useEffect(() => {
    // Only react to a newly observed workspace version, never an older snapshot
    // still on screen between a successful save and its workspace refresh.
    if (!observed || observedDigest.current === observed.digest || savingNow.current) return;
    observedDigest.current = observed.digest;
    if (observed.digest === file.digest) return;
    if (dirty) setExternal(observed);
    else replaceWith(observed);
  }, [observed, file.digest, dirty, replaceWith]);

  const reload = useCallback(async () => {
    try {
      const next = await api.file(file.path);
      if (dirty) { setExternal(next); setCompareOpen(true); return; }
      replaceWith(next);
      notify('已载入磁盘上的最新版本。', 'info');
    } catch (cause) { notify(cause instanceof Error ? cause.message : String(cause), 'error'); }
  }, [api, dirty, file.path, notify, replaceWith]);

  const save = useCallback(async () => {
    if (external) { setCompareOpen(true); throw new Error('磁盘内容已变化，请先比较版本。'); }
    const sent = currentDraft.current;
    const before = baseline.current;
    savingNow.current = true;
    try {
      await api.action(source
        ? { action: 'source.set', path: before.path, body: sent, expectedDigest: before.digest }
        : { action: 'document.set', path: before.path, body: sent, expectedDigest: before.digest });
      const next = await api.file(before.path);
      baseline.current = next; setFile(next); observedDigest.current = next.digest;
      if (currentDraft.current === sent) { currentDraft.current = next.body; setDraft(next.body); setLocalDirty(false); }
      else setLocalDirty(currentDraft.current !== next.body);
      setExternal(null); onSaved?.(next);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const next = await api.file(before.path).catch(() => null);
        if (next) setExternal(next);
        setCompareOpen(true);
      }
      throw cause;
    } finally { savingNow.current = false; }
  }, [api, external, onSaved, refresh, source]);
  const autoSave = useAutoSave({ dirty, revision: draft, save, enabled: !file.readOnly });
  const saving = autoSave.saving;
  const changeDraft = (value: string) => { currentDraft.current = value; setDraft(value); setLocalDirty(value !== baseline.current.body); };
  const rawEditor = <Textarea
    aria-label={source ? '源码原文' : 'Markdown 原文'}
    className="raw-editor"
    value={draft}
    readOnly={file.readOnly || busy}
    onChange={event => changeDraft(event.target.value)}
  />;
  const toolbarActions = <div className="toolbar-actions">
    {external && <Button variant="outline" size="sm" onClick={() => setCompareOpen(true)}><GitCompareArrows /> 外部变更</Button>}
    <Button variant="outline" size="sm" onClick={() => void reload()} disabled={saving}><RefreshCw /> 重新载入</Button>
    <span role="status">{file.readOnly ? '只读' : autoSave.status}</span>
    {autoSave.error && <Button variant="outline" size="sm" onClick={() => { void autoSave.flush().catch(() => undefined); }}>重试保存</Button>}
  </div>;

  return <div className="editor-shell" data-dirty={dirty}>
    {toolbarTarget && !source && createPortal(toolbarActions, toolbarTarget)}
    {(!toolbarTarget || source) && <div className="editor-shell__bar" data-compact={!source || undefined}>
      {source && <div>
        <div className="eyebrow">源码文件</div>
        <strong>{title ?? file.path}</strong>
        <div className="path-text">{file.path}</div>
      </div>}
      {toolbarActions}
    </div>}
    {autoSave.error && <div className="form-error" role="alert">{autoSave.error}</div>}
    {file.readOnly && <div className="callout callout--warning"><AlertTriangle /> <div><strong>只读</strong><p>{file.reason ?? '当前内容不能由工作台安全修改。'}</p></div></div>}
    {external && <div className="callout callout--warning"><AlertTriangle /><div><strong>磁盘内容已变化</strong><p>当前草稿没有被覆盖。请比较后保留草稿或重新载入。</p></div></div>}
    {unsupported && <div className="callout callout--warning"><AlertTriangle /><div><strong>已切换为原文编辑</strong><p>WYSIWYG 无法无损解析该语法：{unsupported}。原始字节内容保持不变，只有你的明确编辑才会标记为未保存。</p></div></div>}
    {source || unsupported ? rawEditor : <MarkdownErrorBoundary
      fallback={rawEditor}
      onError={error => setUnsupported(error.message)}
    >
      <MDXEditor
        key={editorKey}
        className="wysiwyg"
        contentEditableClassName="wysiwyg__content"
        markdown={file.body}
        trim={false}
        suppressHtmlProcessing
        readOnly={file.readOnly || busy}
        placeholder="开始撰写正文…"
        onError={({ error }) => setUnsupported(error)}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (initialMarkdownNormalize) return;
          changeDraft(markdown);
        }}
        plugins={[
          headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin(), linkDialogPlugin(), tablePlugin(), thematicBreakPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '', codeBlockEditorDescriptors: [mermaidCodeBlockDescriptor] }),
          codeMirrorPlugin({ codeBlockLanguages: { '': 'Plain text', ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', json: 'JSON', bash: 'Shell', sh: 'Shell', yaml: 'YAML', python: 'Python', sql: 'SQL' } }),
        ]}
      />
    </MarkdownErrorBoundary>}
    <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
      <DialogContent className="dialog--wide">
        <DialogHeader><DialogTitle>比较未保存草稿</DialogTitle><DialogDescription>左侧是你的草稿，右侧是当前磁盘版本。重新载入会明确丢弃草稿。</DialogDescription></DialogHeader>
        <div className="compare-grid">
          <div><strong>浏览器草稿</strong><pre>{draft}</pre></div>
          <div><strong>磁盘版本</strong><pre>{external?.body ?? '无法读取最新版本'}</pre></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setCompareOpen(false)}>继续编辑草稿</Button><Button variant="destructive" disabled={!external} onClick={() => { if (external) replaceWith(external); setCompareOpen(false); }}>丢弃草稿并载入</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
