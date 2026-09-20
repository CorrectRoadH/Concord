// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { urlChoice, useUrlNavigation } from '../hooks/use-url-navigation';
import { json } from '../lib/utils';

const labels: Readonly<Record<string, string>> = {
  id: '标识', caseId: '测试', operation: '操作', name: '名称', kind: '类型', status: '状态',
  ok: '检查通过', findings: '发现的问题', message: '说明', code: '诊断代码', path: '路径',
  file: '文件', line: '行号', contract: '契约', contracts: '契约关联', regressions: '回归关联',
  startedAt: '开始时间', finishedAt: '结束时间', exitCode: '退出码', cancelled: '已取消',
  timedOut: '已超时', durationMs: '耗时（毫秒）', stdout: '标准输出', stderr: '错误输出',
  changedPaths: '修改的文件', dryRun: '预览操作', root: '仓库', state: '状态', evidence: '证据',
  title: '标题', incoming: '引用此项', outgoing: '此项引用', edges: '关联', documents: '文档',
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function Fields({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="muted">无</span>;
  if (typeof value === 'boolean') return <Badge variant={value ? 'default' : 'secondary'}>{value ? '是' : '否'}</Badge>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (depth > 3) return <details><summary>展开详情</summary><pre>{json(value)}</pre></details>;
  if (Array.isArray(value)) return value.length === 0 ? <span className="muted">无</span> : (
    <ul className="grid gap-3">{value.map((item, index) => <li className="border-b border-border py-3" key={index}><Fields value={item} depth={depth + 1} /></li>)}</ul>
  );
  return <dl className="grid gap-3">{Object.entries(value).map(([key, item]) => (
    <div className="grid min-w-0 gap-1" key={key}>
      <dt className="text-sm font-medium text-muted-foreground">{labels[key] ?? key}</dt>
      <dd className="min-w-0"><Fields value={item} depth={depth + 1} /></dd>
    </div>
  ))}</dl>;
}

export function ActionResult({ title, value }: { title: string; value: unknown }) {
  const { params, update } = useUrlNavigation();
  const tab = urlChoice(params.get('resultView'), ['preview', 'source'], 'preview');
  const markdown = record(value) ? (typeof value.markdown === 'string' ? value.markdown : value.operation === 'template-show' && typeof value.body === 'string' ? value.body : null) : null;
  const snippet = record(value) && typeof value.snippet === 'string' ? value.snippet : null;
  return <Card className="result-card"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>
    {markdown !== null ? <Tabs value={tab} onValueChange={value => update({ resultView: value })}>
      <TabsList><TabsTrigger value="preview">阅读预览</TabsTrigger><TabsTrigger value="source">Markdown 原文</TabsTrigger></TabsList>
      <TabsContent value="preview"><article className="wysiwyg__content min-h-0"><Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown></article></TabsContent>
      <TabsContent value="source"><pre>{markdown}</pre></TabsContent>
    </Tabs> : snippet !== null ? <pre>{snippet}</pre> : typeof value === 'string' ? <pre>{value}</pre> : <Fields value={value} />}
    {typeof value === 'object' && <details className="mt-5"><summary className="cursor-pointer text-sm text-muted-foreground">完整数据 JSON</summary><pre>{json(value)}</pre></details>}
  </CardContent></Card>;
}
