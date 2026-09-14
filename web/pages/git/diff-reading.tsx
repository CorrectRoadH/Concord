import * as stylex from '@stylexjs/stylex';
import { Diff, Hunk, parseDiff } from 'react-diff-view';
import { AlertTriangle, FileDiff } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { GitDiff } from '../../../src/git-view';
import { Badge } from '../../components/ui/badge';

const styles = stylex.create({
  scroll: { flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' },
  hint: { marginBlock: 12, marginInline: 8, fontSize: 11, color: 'var(--muted-foreground)' },
  container: {
    padding: 12, minWidth: 0,
    '--diff-background-color': 'var(--card)',
    '--diff-text-color': 'var(--foreground)',
    '--diff-font-family': '"SFMono-Regular", Consolas, monospace',
    '--diff-code-insert-background-color': 'color-mix(in srgb, #228b4b 16%, var(--card))',
    '--diff-code-delete-background-color': 'color-mix(in srgb, #be4034 16%, var(--card))',
    '--diff-gutter-insert-background-color': 'color-mix(in srgb, #228b4b 28%, var(--card))',
    '--diff-gutter-delete-background-color': 'color-mix(in srgb, #be4034 28%, var(--card))',
  },
  file: { overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 7 },
  title: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBlock: 7, paddingInline: 10, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border)', backgroundColor: 'var(--muted)', fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere' },
  diff: { fontSize: 12 },
  gutter: { color: 'var(--muted-foreground)' },
  message: { display: 'grid', minHeight: 300, placeItems: 'center', alignContent: 'center', gap: 12, padding: 32, color: 'var(--muted-foreground)', textAlign: 'center' },
  notice: { display: 'flex', alignItems: 'flex-start', gap: 12, margin: 12, padding: 16, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 7, color: 'var(--foreground)', backgroundColor: 'var(--muted)' },
});

export function DiffReading({ value, view, line, position, remember }: {
  value: GitDiff; view: 'split' | 'unified'; line?: number; position: number;
  remember(position: number): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const target = line ? element.querySelector<HTMLElement>(`[id="git-line-${line}"]`) : null;
    element.scrollTop = target ? element.scrollTop + target.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3 : position;
    // Background refreshes must not pull readers back to the original target line.
  }, [line, view]);
  return <div ref={scroller} data-testid="git-diff-scroll" {...stylex.props(styles.scroll)} onScroll={event => remember(event.currentTarget.scrollTop)}>
    {line && <p {...stylex.props(styles.hint)}>定位当前文件第 {line} 行；该行不在此 diff 中时显示文件差异。</p>}
    <DiffView value={value} view={view} />
  </div>;
}

function DiffView({ value, view }: { value: GitDiff; view: 'split' | 'unified' }) {
  const parsed = useMemo(() => {
    try { return { files: parseDiff(value.patch, { nearbySequences: 'zip' }), error: '' }; }
    catch (cause) { return { files: [], error: cause instanceof Error ? cause.message : String(cause) }; }
  }, [value.patch]);
  if (value.binary || value.message && !value.patch) return <div {...stylex.props(styles.message)}><FileDiff /><strong>{value.binary ? '二进制文件' : '无法显示文本差异'}</strong><p>{value.message ?? '二进制内容不提供文本预览。'}</p></div>;
  if (parsed.error) return <div {...stylex.props(styles.notice)}><AlertTriangle /><div><strong>统一 diff 无法解析</strong><p>{parsed.error}</p></div></div>;
  if (parsed.files.length === 0) return <div {...stylex.props(styles.message)}><FileDiff /><strong>没有可显示的文本 hunk</strong><p>{value.message ?? '该变更可能只包含模式或重命名信息。'}</p></div>;
  return <div {...stylex.props(styles.container)}>{value.truncated && <div {...stylex.props(styles.notice)}><AlertTriangle /><div><strong>输出已截断</strong><p>这里只显示服务端安全上限内的内容。</p></div></div>}{value.message && <div {...stylex.props(styles.notice)}><AlertTriangle /><div><p>{value.message}</p></div></div>}{parsed.files.map((file, index) => <div {...stylex.props(styles.file)} key={`${file.oldPath}-${file.newPath}-${index}`}><div {...stylex.props(styles.title)}><span>{file.oldPath || '/dev/null'}</span><span>→</span><span>{file.newPath || value.path}</span><Badge variant="outline">{file.type}</Badge></div><Diff {...stylex.props(styles.diff)} gutterClassName={stylex.props(styles.gutter).className} generateAnchorID={change => change.type === 'delete' ? undefined : `git-line-${change.type === 'normal' ? change.newLineNumber : change.lineNumber}`} viewType={view} diffType={file.type} hunks={file.hunks} optimizeSelection>{hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}</Diff></div>)}</div>;
}
