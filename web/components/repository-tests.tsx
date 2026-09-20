import { Link } from 'react-router-dom';
import type { DocumentRecord } from '../../src/shared';
import type { WorkspaceSnapshot } from '../../src/view-contract';
import { Definition } from './page';
import { Button } from './ui/button';
import { RecordDetails, RecordItem } from './content-layout';

export function relatedRepositoryTests(snapshot: WorkspaceSnapshot, document: DocumentRecord) {
  return (snapshot.repositoryTests?.tests ?? []).filter(test => document.metadata.kind === 'feature'
    ? test.features.includes(document.path)
    : test.contract.split('#')[0] === document.path);
}

export function RepositoryTestCards({ snapshot, document, onOpenSource }: { snapshot: WorkspaceSnapshot; document: DocumentRecord; onOpenSource: (path: string) => void }) {
  const view = snapshot.repositoryTests;
  if (view?.status === 'failed') return <li role="alert" className="form-error">项目测试接入失败：{view.error?.code} — {view.error?.message}</li>;
  const tests = relatedRepositoryTests(snapshot, document);
  return <>{tests.map(test => <RecordItem key={test.selector}>
    <div className="card-title-row"><strong>{test.name}</strong><Button asChild variant="ghost" size="sm"><Link to={`/git?path=${encodeURIComponent(test.file)}&tab=tests`}>查看文件变更</Link></Button></div><div><Button className="h-auto max-w-full justify-start whitespace-normal p-0 text-left" variant="link" onClick={() => onOpenSource(test.file)}>{test.file}</Button></div>
    <RecordDetails><dl>
      <Definition label="契约"><code>{test.contract}</code></Definition>
    </dl></RecordDetails>
  </RecordItem>)}</>;
}

export function scanFindings(snapshot: WorkspaceSnapshot, kind: 'tests' | 'sources') {
  const roots = (kind === 'tests' ? snapshot.project?.testRoots : snapshot.project?.sourceRoots) ?? [];
  return snapshot.findings.filter(finding => roots.some(root => finding.path === root || finding.path.startsWith(`${root}/`)));
}

export function ScanNotice({ snapshot, kind }: { snapshot: WorkspaceSnapshot; kind: 'tests' | 'sources' }) {
  const roots = (kind === 'tests' ? snapshot.project?.testRoots : snapshot.project?.sourceRoots) ?? [];
  const label = kind === 'tests' ? '通用测试' : '源码声明';
  if (kind === 'tests' && roots.length === 0 && snapshot.repositoryTests?.status === 'ready') return null;
  if (kind === 'tests' && roots.length === 0 && snapshot.repositoryTests?.status === 'failed') return null;
  if (roots.length === 0) return <p role="status">尚未配置{label}扫描目录。<Link to="/settings">前往项目设置</Link></p>;
  const findings = scanFindings(snapshot, kind);
  if (findings.length === 0) return null;
  return <div role="alert">{label}扫描存在问题，列表可能不完整。{findings.map((finding, index) => <p key={index}>{finding.code}：{finding.path} — {finding.message}</p>)}</div>;
}
