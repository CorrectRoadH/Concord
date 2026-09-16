// @concord-file workbench-source-drawer
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useEffect, useState } from 'react';
import type { ViewFile } from '../../src/view-contract';
import { useWorkspace } from '../workspace';
import { DetailDrawer } from './detail-drawer';
import { MarkdownEditor } from './markdown-editor';

export interface SourceLocation {
  readonly path: string;
  readonly line: number;
  readonly endLine: number;
}

export function SourceDrawer({ location, editable = false, onClose }: {
  readonly location: SourceLocation | null;
  readonly editable?: boolean;
  readonly onClose: () => void;
}) {
  const { api } = useWorkspace();
  const [file, setFile] = useState<ViewFile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setFile(null); setError('');
    if (location) void api.file(location.path, controller.signal).then(value => {
      if (!controller.signal.aborted) setFile(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [api, location]);
  return <DetailDrawer open={location !== null} onClose={onClose} fullscreen model={{
    title: location?.path ?? '源码',
    description: location ? `第 ${location.line}–${location.endLine} 行` : '源码位置',
  }}>
    {error ? <p role="alert">源码读取失败：{error}</p> : file && location && file.path === location.path
      ? <MarkdownEditor key={file.path} initial={editable ? file : { ...file, readOnly: true, reason: '测试源码在此处仅供检查。' }} source sourceLocation={location} hideSourceHeading />
      : <p role="status">正在读取源码…</p>}
  </DetailDrawer>;
}
