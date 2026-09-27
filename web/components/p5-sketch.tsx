// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/embed-p5-sketch.md
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Effect, Schema } from 'effect';
import { CodeMirrorEditor, useCodeBlockEditorContext, type CodeBlockEditorProps } from '@mdxeditor/editor';
import { P5BundleSchema, P5EventSchema, parseP5Options, type P5Bundle } from '../../src/p5-contract';
import { Button } from './ui/button';
import { Input } from './ui/input';

export const P5DocumentContext = createContext<string | undefined>(undefined);
const ResponseSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: P5BundleSchema }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String, message: Schema.String, details: Schema.optional(Schema.Unknown) }),
]);

export function P5Sketch({ code, meta, document: documentPath }: { code: string; meta: string; document?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const [bundle, setBundle] = useState<P5Bundle>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('点击运行 p5 图解');
  const [paused, setPaused] = useState(false);
  const [height, setHeight] = useState(300);
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const visibility = useRef(true);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const updateLoop = () => frame.current?.contentWindow?.postMessage({ kind: pausedRef.current || !visibility.current || document.hidden ? 'pause' : 'resume' }, '*');

  const stop = () => {
    request.current?.abort(); request.current = undefined;
    setBundle(undefined); setLoading(false); setPaused(false);
    setStatus('已停止');
  };
  useEffect(() => {
    stop(); setError(''); setStatus('点击运行 p5 图解');
    return () => { request.current?.abort(); };
  }, [code, meta, documentPath]);

  const run = () => {
    stop(); setError(''); setLoading(true); setStatus('正在编译…');
    const controller = new AbortController(); request.current = controller;
    void Effect.runPromise(Effect.tryPromise({ try: async () => {
      parseP5Options(meta);
      if (!documentPath) throw new Error('当前预览缺少文档路径，无法运行 p5 图解');
      const response = await fetch('/api/p5/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: documentPath, code, meta }), signal: controller.signal });
      const result = Schema.decodeUnknownSync(ResponseSchema, { onExcessProperty: 'error' })(await response.json());
      if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
      if (!response.ok) throw new Error('p5 编译请求失败');
      if (!controller.signal.aborted) {
        setBundle(result.value); setGeneration(value => value + 1); setStatus('正在启动…');
      }
    }, catch: cause => cause })).catch(cause => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('运行失败'); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  };

  useEffect(() => {
    if (!bundle) return;
    let ready = false;
    const timer = window.setTimeout(() => { if (!ready) { setError('P5StartupTimeout: 图解未能启动，可停止后重试'); setStatus('启动超时'); } }, 15000);
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const decoded = Schema.decodeUnknownOption(P5EventSchema, { onExcessProperty: 'error' })(event.data);
      if (decoded._tag !== 'Some') return;
      const data = decoded.value;
      if (data.kind === 'ready') frame.current?.contentWindow?.postMessage({ kind: 'start', bundle }, '*');
      if (data.kind === 'started') { ready = true; setStatus('运行中'); window.clearTimeout(timer); updateLoop(); }
      if (data.kind === 'error') { ready = true; setError(data.message); setStatus('运行失败'); window.clearTimeout(timer); }
      if (data.kind === 'resize') setHeight(data.height);
    };
    window.addEventListener('message', receive);
    return () => { window.removeEventListener('message', receive); window.clearTimeout(timer); };
  }, [bundle, generation]);

  useEffect(() => {
    if (!bundle || !container.current) return;
    const observer = new IntersectionObserver(entries => { visibility.current = entries[0]?.isIntersecting ?? true; updateLoop(); });
    observer.observe(container.current);
    document.addEventListener('visibilitychange', updateLoop);
    updateLoop();
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', updateLoop); };
  }, [bundle, paused, generation]);

  return <div ref={container} className="p5-sketch" data-testid="p5-sketch">
    <div className="p5-controls" contentEditable={false}>
      <Button type="button" variant="outline" size="sm" onClick={run} disabled={loading}>{bundle ? '重新运行' : '运行 p5'}</Button>
      {bundle && <Button type="button" variant="outline" size="sm" onClick={() => setPaused(value => !value)}>{paused ? '继续动画' : '暂停动画'}</Button>}
      {(bundle || loading) && <Button type="button" variant="outline" size="sm" onClick={stop}>停止</Button>}
      <span role="status">{paused ? '动画已暂停' : status}</span>
    </div>
    {error && <pre role="alert" className="p5-error">{error}</pre>}
    {bundle && <iframe key={generation} ref={frame} title="p5 图解" src="/p5-frame" sandbox="allow-scripts allow-downloads" allow="camera 'none'; microphone 'none'; geolocation 'none'" referrerPolicy="no-referrer" style={{ height }} />}
  </div>;
}

function P5CodeBlockEditor(props: CodeBlockEditorProps) {
  const documentPath = useContext(P5DocumentContext);
  const { setMeta } = useCodeBlockEditorContext();
  return <div>
    <P5Sketch code={props.code} meta={props.meta} document={documentPath} />
    <details className="p5-source">
      <summary>编辑 p5 源码与引用</summary>
      <Input aria-label="p5 引用与选项" value={props.meta} placeholder={'src="./demo/main.ts" css="./demo/style.css"'} onChange={event => setMeta(event.target.value)} />
      <CodeMirrorEditor {...props} language="typescript" />
    </details>
  </div>;
}
export const p5CodeBlockDescriptor = { priority: 100, match: (language: string | null | undefined) => language === 'p5', Editor: P5CodeBlockEditor };
