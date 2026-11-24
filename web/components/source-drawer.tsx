// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#项目测试只读投影
import { useEffect, useState } from 'react';
import type { ViewFile } from '../../src/model/index.ts';
import { useWorkspace } from '../workspace.tsx';
import { DetailDrawer } from './detail-drawer.tsx';
import { MarkdownEditor, codeMirrorExtensions } from './markdown-editor.tsx';
import { SourceEditor } from './source-editor.tsx';

export interface SourceLocation {
  readonly path: string;
  readonly line: number;
  readonly endLine: number;
}

export function SourceDrawer({ location, editable = false, onClose }: {
  readonly location: SourceLocation | Pick<SourceLocation, 'path'> | null;
  readonly editable?: boolean;
  readonly onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [file, setFile] = useState<ViewFile | null>(null);
  const [error, setError] = useState('');
  const path = location?.path;
  const lines = location && 'line' in location ? location : undefined;
  useEffect(() => {
    const controller = new AbortController();
    setFile(null); setError('');
    if (path) void api.file(path, controller.signal).then(value => {
      if (!controller.signal.aborted) setFile(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [api, path]);
  return <DetailDrawer open={location !== null} onClose={onClose} fullscreen model={{
    title: location?.path ?? '源码',
    description: lines ? `第 ${lines.line}–${lines.endLine} 行` : '源码',
  }}>
    {error ? <p role="alert">源码读取失败：{error}</p> : file && location && file.path === location.path
      ? editable
        ? <MarkdownEditor key={file.path} initial={file} source sourceLocation={lines} hideSourceHeading />
        : <SourceEditor key={file.path} value={file.body} path={file.path} readOnly extensions={codeMirrorExtensions} location={lines} onChange={() => undefined} />
      : <p role="status">正在读取源码…</p>}
  </DetailDrawer>;
}
